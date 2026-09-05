const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const workspace = path.resolve(__dirname, '..')
const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = Number(portIndex >= 0 ? args[portIndex + 1] : 9333)
const noFail = args.includes('--no-fail')
const outlineModeIndex = args.indexOf('--outline-mode')
const outlineMode = outlineModeIndex >= 0 ? args[outlineModeIndex + 1] : 'baked'
const endpoint = `http://127.0.0.1:${port}`
let child

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function stopChild() {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Electron exited with code ${child.exitCode}.`)
    try {
      const targets = await fetch(`${endpoint}/json/list`).then((response) =>
        response.json()
      )
      const target = targets.find(
        (candidate) => candidate.type === 'page' && candidate.webSocketDebuggerUrl
      )
      if (target) return target
    } catch {
      // The debugger endpoint is expected to be unavailable during startup.
    }
    await delay(250)
  }
  throw new Error(`Timed out waiting for Electron's debugger on port ${port}.`)
}

function createCdpClient(url) {
  const socket = new WebSocket(url)
  const pending = new Map()
  let nextId = 1

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed.')), {
      once: true
    })
  })

  return {
    async call(method, params = {}) {
      await ready
      const id = nextId++
      const result = new Promise((resolve, reject) =>
        pending.set(id, { resolve, reject })
      )
      socket.send(JSON.stringify({ id, method, params }))
      return result
    },
    close() {
      socket.close()
    }
  }
}

async function waitForBenchmark(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await client.call('Runtime.evaluate', {
      expression: "typeof window.__matchPerformanceBenchmark !== 'undefined'",
      returnByValue: true
    })
    if (response.result.value === true) return
    await delay(250)
  }
  throw new Error('Timed out waiting for the match benchmark to start.')
}

async function captureFullHandScreenshot(client, outputDirectory, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await client.call('Runtime.evaluate', {
      expression: 'window.__matchPerformanceScreenshotStage',
      returnByValue: true
    })
    const stage = response.result.value
    if (typeof stage === 'string' && stage.length > 0) {
      const screenshot = await client.call('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false
      })
      const screenshotPath = path.join(outputDirectory, `${stage}.png`)
      fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
      await client.call('Runtime.evaluate', {
        expression: `window.__matchPerformanceScreenshotAck = ${JSON.stringify(stage)}`
      })
      return screenshotPath
    }
    await delay(100)
  }
  throw new Error('Timed out waiting for the full-hand screenshot stage.')
}

function printReport(report, artifactPath) {
  const headers = ['scenario', 'kind', 'fps', 'p95', 'p99', 'max', '>33ms', 'status']
  const rows = report.scenarios.map((sample) => [
    sample.name,
    sample.kind,
    sample.averageFps.toFixed(1),
    `${sample.p95Ms.toFixed(1)}ms`,
    `${sample.p99Ms.toFixed(1)}ms`,
    `${sample.maxMs.toFixed(1)}ms`,
    String(sample.framesOver33Ms),
    sample.status
  ])
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  )
  const format = (row) =>
    row.map((value, column) => value.padEnd(widths[column])).join('  ')

  console.log('\nMatch performance benchmark')
  console.log(format(headers))
  console.log(format(widths.map((width) => '-'.repeat(width))))
  for (const row of rows) console.log(format(row))
  console.log(
    `\nHeap: ${report.heap.map((sample) => `${sample.name}=${sample.usedMiB ?? 'n/a'} MiB`).join(', ')}`
  )
  console.log(`Report: ${artifactPath}`)
  console.log(`Result: ${report.status.toUpperCase()}`)
}

async function main() {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid debugger port: ${port}`)
  }
  if (outlineMode !== 'live' && outlineMode !== 'baked') {
    throw new Error(`Invalid outline mode: ${outlineMode}`)
  }

  child = spawn(
    process.execPath,
    [path.join('scripts', 'run.cjs'), 'dev', '--remoteDebuggingPort', String(port)],
    {
      cwd: workspace,
      env: {
        ...process.env,
        VITE_DEV_START_ROUTE: 'match-performance',
        VITE_MATCH_OUTLINE_MODE: outlineMode,
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))
  child.stderr.on('data', (chunk) => process.stderr.write(chunk))

  const target = await waitForTarget(45_000)
  const client = createCdpClient(target.webSocketDebuggerUrl)
  try {
    await client.call('Runtime.enable')
    await client.call('Page.enable')
    await waitForBenchmark(client, 45_000)
    const outputDirectory = path.join(workspace, 'artifacts', 'match-performance')
    fs.mkdirSync(outputDirectory, { recursive: true })
    const [response, screenshotPath] = await Promise.all([
      client.call('Runtime.evaluate', {
        expression: 'window.__matchPerformanceBenchmark',
        awaitPromise: true,
        returnByValue: true
      }),
      captureFullHandScreenshot(client, outputDirectory, 60_000)
    ])
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ?? 'Benchmark failed.'
      )
    }
    const report = response.result.value
    if (!report?.scenarios) throw new Error('Benchmark returned no report.')

    const artifactPath = path.join(outputDirectory, 'latest.json')
    fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    fs.writeFileSync(
      path.join(outputDirectory, `${outlineMode}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8'
    )
    printReport(report, artifactPath)
    console.log(`Screenshot: ${screenshotPath}`)
    if (report.status !== 'pass' && !noFail) process.exitCode = 1
  } finally {
    client.close()
  }
}

process.once('SIGINT', () => {
  stopChild()
  process.exit(130)
})
process.once('SIGTERM', () => {
  stopChild()
  process.exit(143)
})

main()
  .catch((error) => {
    console.error(`\nMatch performance benchmark failed: ${error.stack ?? error}`)
    process.exitCode = 1
  })
  .finally(stopChild)
