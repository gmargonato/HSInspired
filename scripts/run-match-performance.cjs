const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')

const workspace = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1]
}
const smoke = args.includes('--smoke')
const port = Number(option('--port', 9333))
const noFail = args.includes('--no-fail')
const outlineMode = option('--outline-mode', 'live')
const sampleMs = Number(option('--sample-ms', smoke ? 1_000 : 10_000))
const repetitions = Number(option('--repetitions', smoke ? 1 : 3))
const cycles = Number(option('--cycles', smoke ? 5 : 100))
const handSizes = String(option('--hand-sizes', smoke ? '1,10' : '1,4,7,10'))
const label = String(option('--label', 'latest'))
const endpoint = `http://127.0.0.1:${port}`
let child
let benchmarkRoot
let client
let stopping = false

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopChild() {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
  } else {
    child.kill('SIGTERM')
  }
}

function cleanTemporaryProfile() {
  if (!benchmarkRoot) return
  const resolved = path.resolve(benchmarkRoot)
  const relative = path.relative(path.resolve(os.tmpdir()), resolved)
  if (
    !relative ||
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !path.basename(resolved).startsWith('hsinspired-match-perf-')
  )
    throw new Error(`Refusing to remove unexpected benchmark profile: ${resolved}`)
  try {
    fs.rmSync(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    })
  } catch (error) {
    console.warn(`Temporary benchmark profile remains at ${resolved}: ${error.message}`)
  }
  benchmarkRoot = undefined
}

async function assertPortAvailable() {
  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Electron exited with code ${child.exitCode}.`)
    try {
      const targets = await fetch(`${endpoint}/json/list`, {
        signal: AbortSignal.timeout(2_000)
      }).then((response) => response.json())
      const target = targets.find(
        (candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl
      )
      if (target) return target
    } catch {
      /* The debugger is unavailable during startup. */
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for Electron's debugger on port ${port}.`)
}

function createCdpClient(url) {
  const socket = new WebSocket(url),
    pending = new Map()
  let nextId = 1
  const failPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  socket.addEventListener('close', () =>
    failPending(new Error('CDP connection closed.'))
  )
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('CDP connection timed out.')),
      10_000
    )
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timer)
        reject(new Error('CDP connection failed.'))
      },
      { once: true }
    )
  })
  return {
    async call(method, params = {}, timeoutMs = 30_000) {
      await ready
      const id = nextId++
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`${method} timed out.`))
        }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
      })
      socket.send(JSON.stringify({ id, method, params }))
      return result
    },
    close() {
      failPending(new Error('CDP client stopped.'))
      socket.close()
    }
  }
}

async function evaluate(expression) {
  const response = await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true
  })
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ?? 'Renderer evaluation failed.'
    )
  return response.result.value
}

async function waitForBenchmark(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate("typeof window.__matchPerformanceBenchmark !== 'undefined'"))
      return
    await delay(100)
  }
  throw new Error('Timed out waiting for the match benchmark to start.')
}

async function browserGpuInfo() {
  let browser
  try {
    const version = await fetch(`${endpoint}/json/version`, {
      signal: AbortSignal.timeout(2_000)
    }).then((response) => response.json())
    browser = createCdpClient(version.webSocketDebuggerUrl)
    const info = await browser.call('SystemInfo.getInfo')
    return {
      devices: info.gpu.devices,
      featureStatus: info.gpu.featureStatus,
      auxAttributes: info.gpu.auxAttributes,
      driverBugWorkarounds: info.gpu.driverBugWorkarounds
    }
  } catch (error) {
    return { unavailable: error.message }
  } finally {
    browser?.close()
  }
}

function interpolate(points, progress) {
  if (points.length === 1)
    return { x: points[0].x + Math.sin(progress * Math.PI * 2) * 16, y: points[0].y }
  const offset = progress * (points.length - 1)
  const index = Math.min(points.length - 2, Math.floor(offset))
  const fraction = offset - index,
    from = points[index],
    to = points[index + 1]
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction
  }
}

/** CDP injects actual browser mouse input; no feature methods are invoked here. */
async function driveInput(stage) {
  let position
  let moves = 0
  const startedAt = performance.now()
  const mouse = async (type, point, button = 'none', buttons = 0) => {
    position = point
    await client.call('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button,
      buttons,
      ...(type === 'mouseMoved' ? {} : { clickCount: 1 }),
      pointerType: 'mouse'
    })
    if (type === 'mouseMoved') moves += 1
  }
  for (let cycle = 0; cycle < stage.cycles; cycle += 1) {
    await mouse('mouseMoved', stage.start)
    await delay(50)
    const dragging = stage.gesture !== 'hover'
    if (dragging) {
      await mouse('mousePressed', stage.start, 'left', 1)
      await delay(40)
    }
    const motionStartedAt = performance.now()
    const movementDuration = Math.max(
      1,
      stage.durationMs - Math.min(350, stage.durationMs * 0.2)
    )
    let nextMoveAt = motionStartedAt
    do {
      const elapsed = performance.now() - motionStartedAt
      let progress
      if (
        stage.gesture === 'target' ||
        stage.gesture === 'pickup' ||
        stage.gesture === 'cycles'
      ) {
        progress = Math.min(1, elapsed / movementDuration)
      } else {
        const phase = (Math.min(elapsed, movementDuration) % 1_600) / 800
        progress = phase <= 1 ? phase : 2 - phase
      }
      position = interpolate(stage.path, progress)
      await mouse('mouseMoved', position, 'none', dragging ? 1 : 0)
      nextMoveAt = Math.max(nextMoveAt + 1_000 / 120, performance.now())
      await delay(Math.max(0, nextMoveAt - performance.now()))
    } while (performance.now() - motionStartedAt < stage.durationMs)
    if (dragging) {
      // A right-button chord while left is held does not emit another DOM
      // pointerdown. Release over the hand first, then send an ordinary right
      // click to cancel any remaining click-to-carry or targeting state.
      await mouse('mouseMoved', stage.start, 'none', 1)
      await delay(30)
      await mouse('mouseReleased', stage.start, 'left', 0)
      await mouse('mousePressed', stage.start, 'right', 2)
      await mouse('mouseReleased', stage.start, 'right', 0)
    }
    await mouse('mouseMoved', { x: 4, y: 4 })
    await delay(stage.settleMs)
  }
  return {
    stageId: stage.id,
    gesture: stage.gesture,
    cycles: stage.cycles,
    requestedHz: 120,
    moves,
    elapsedMs: performance.now() - startedAt
  }
}

async function serviceStages(outputDirectory, complete, driverSamples, screenshots) {
  let lastStage = 0
  let lastProgress = '',
    lastHeartbeatAt = 0
  while (!complete.done && !stopping) {
    const state = await evaluate(
      '({ stage: window.__matchPerformanceStage, progress: window.__matchPerformanceProgress })'
    )
    const { stage, progress } = state
    if (
      progress &&
      (progress.name !== lastProgress || Date.now() - lastHeartbeatAt > 10_000)
    ) {
      console.log(`[benchmark] ${progress.name}: ${progress.frames} submitted frames`)
      lastProgress = progress.name
      lastHeartbeatAt = Date.now()
    }
    if (!stage || stage.id === lastStage) {
      await delay(20)
      continue
    }
    lastStage = stage.id
    console.log(
      `[benchmark] ${stage.scenario ?? stage.name ?? stage.id}: ${stage.gesture ?? stage.kind}`
    )
    let error
    try {
      if (stage.kind === 'input') driverSamples.push(await driveInput(stage))
      else if (stage.kind === 'screenshot') {
        const screenshot = await client.call('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false
        })
        const filePath = path.join(
          outputDirectory,
          `${label}-${stage.name.replace(/[^a-z0-9-]/gi, '-')}.png`
        )
        fs.writeFileSync(filePath, Buffer.from(screenshot.data, 'base64'))
        screenshots.push(filePath)
      }
    } catch (failure) {
      error = failure.message
    }
    await evaluate(
      `window.__matchPerformanceAck = ${JSON.stringify({ id: stage.id, ...(error ? { error } : {}) })}`
    )
    if (error) throw new Error(error)
  }
}

function printReport(report, artifactPath) {
  const headers = [
    'scenario',
    'fps',
    'p95',
    'p99',
    'CPU95',
    'input95',
    '>33ms',
    'status'
  ]
  const metric = (value) =>
    typeof value === 'number' ? `${value.toFixed(1)}ms` : 'n/a'
  const rows = report.scenarios.map((sample) => [
    sample.name,
    sample.averageFps.toFixed(1),
    metric(sample.p95Ms),
    metric(sample.p99Ms),
    metric(sample.cpuUpdateAndSubmissionMs.p95),
    metric(sample.inputReceiptToSubmissionMs.p95),
    String(sample.framesOver33Ms),
    sample.status
  ])
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  )
  const format = (row) =>
    row.map((value, column) => value.padEnd(widths[column])).join('  ')
  console.log('\nMatch hand and drag performance')
  console.log(format(headers))
  console.log(format(widths.map((width) => '-'.repeat(width))))
  for (const row of rows) console.log(format(row))
  console.log(`\nReport: ${artifactPath}`)
  console.log(
    `Result: ${report.status.toUpperCase()}${smoke ? ' (smoke run; not a full acceptance sample)' : ''}`
  )
}

async function main() {
  if (!Number.isInteger(port) || port <= 0 || port > 65535)
    throw new Error(`Invalid debugger port: ${port}`)
  if (outlineMode !== 'live') throw new Error(`Invalid outline mode: ${outlineMode}`)
  if (!Number.isInteger(sampleMs) || sampleMs < 250 || sampleMs > 60_000)
    throw new Error('Sample duration must be 250–60000 ms.')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
    throw new Error('Repetitions must be 1–10.')
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 1_000)
    throw new Error('Pickup cycles must be 1–1000.')
  if (!/^(1|4|7|10)(,(1|4|7|10))*$/.test(handSizes))
    throw new Error('Hand sizes must be a comma-separated selection of 1,4,7,10.')
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(label))
    throw new Error('Label must contain only letters, numbers and hyphens.')
  await assertPortAvailable()
  benchmarkRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hsinspired-match-perf-'))
  for (const directory of ['user-data', 'session-data', 'match-logs'])
    fs.mkdirSync(path.join(benchmarkRoot, directory))
  child = spawn(
    process.execPath,
    [path.join('scripts', 'run.cjs'), 'dev', '--remoteDebuggingPort', String(port)],
    {
      cwd: workspace,
      windowsHide: true,
      env: {
        ...process.env,
        VITE_DEV_START_ROUTE: 'match-performance',
        VITE_MATCH_OUTLINE_MODE: outlineMode,
        HSINSPIRED_MATCH_PERFORMANCE_ROOT: benchmarkRoot,
        VITE_MATCH_PERF_SAMPLE_MS: String(sampleMs),
        VITE_MATCH_PERF_REPETITIONS: String(repetitions),
        VITE_MATCH_PERF_CYCLES: String(cycles),
        VITE_MATCH_PERF_HAND_SIZES: handSizes,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))
  const target = await waitForTarget(60_000)
  client = createCdpClient(target.webSocketDebuggerUrl)
  await client.call('Runtime.enable')
  await client.call('Page.enable')
  await client.call('Page.bringToFront')
  await waitForBenchmark(60_000)
  const gpuAtStart = await browserGpuInfo()
  const outputDirectory = path.join(workspace, 'artifacts', 'match-performance')
  fs.mkdirSync(outputDirectory, { recursive: true })
  const complete = { done: false },
    driverSamples = [],
    screenshots = []
  const timeoutMs =
    180_000 +
    handSizes.split(',').length * 2 * (repetitions * 2 * (sampleMs + 1_000) + 10_000) +
    cycles * 1_000
  const reportPromise = client
    .call(
      'Runtime.evaluate',
      {
        expression: 'window.__matchPerformanceBenchmark',
        awaitPromise: true,
        returnByValue: true
      },
      timeoutMs
    )
    .finally(() => {
      complete.done = true
    })
  const [response] = await Promise.all([
    reportPromise,
    serviceStages(outputDirectory, complete, driverSamples, screenshots)
  ])
  if (response.exceptionDetails)
    throw new Error(
      response.exceptionDetails.exception?.description ?? 'Benchmark failed.'
    )
  const report = response.result.value
  if (!report?.scenarios) throw new Error('Benchmark returned no report.')
  const environmentPath = path.join(benchmarkRoot, 'environment.json')
  report.environment = {
    ...report.environment,
    ...(fs.existsSync(environmentPath)
      ? JSON.parse(fs.readFileSync(environmentPath, 'utf8'))
      : {})
  }
  report.configuration.smoke = smoke
  report.environment.gpuAtStart = gpuAtStart
  report.environment.gpuAtCompletion = await browserGpuInfo()
  report.inputDriver = driverSamples
  report.screenshots = screenshots
  const artifactPath = path.join(outputDirectory, `${label}.json`)
  fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  printReport(report, artifactPath)
  if (
    (report.status !== 'pass' && !noFail) ||
    report.scenarios.some((sample) => sample.validInput === false)
  )
    process.exitCode = 1
  await client.call('Browser.close', {}, 5_000).catch(() => undefined)
  for (let attempt = 0; child.exitCode === null && attempt < 20; attempt += 1)
    await delay(100)
}

function cleanup() {
  stopping = true
  stopChild()
  client?.close()
  cleanTemporaryProfile()
}
process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.once('SIGTERM', () => {
  cleanup()
  process.exit(143)
})
main()
  .catch((error) => {
    console.error(`\nMatch performance benchmark failed: ${error.stack ?? error}`)
    process.exitCode = 1
  })
  .finally(cleanup)
