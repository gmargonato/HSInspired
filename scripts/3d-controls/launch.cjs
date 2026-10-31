const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const output = path.join(root, '.tmp', '3d-controls-app')
const capture = process.argv.includes('--capture')

async function main() {
  if (!process.versions.electron) {
    if (
      !fs.existsSync(path.join(__dirname, 'node_modules/three/build/three.module.js'))
    ) {
      throw new Error(
        'Install the isolated dependency first: npm --prefix scripts/3d-controls ci'
      )
    }
    const { spawn } = require('node:child_process')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(require('electron'), [__filename, ...process.argv.slice(2)], {
      env,
      stdio: 'inherit',
      windowsHide: true
    })
    child.on('error', (error) => {
      console.error(error)
      process.exitCode = 1
    })
    child.on('exit', (code) => {
      process.exitCode = code ?? 1
    })
    return
  }
  const { app, BrowserWindow } = require('electron')
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  fs.mkdirSync(output, { recursive: true })
  app.setPath('userData', path.join(output, capture ? 'capture-profile' : 'profile'))
  app.setName('Hearthstone 3D Controls Experiment')
  await app.whenReady()
  const window = new BrowserWindow({
    title: 'Hearthstone · 3D controls experiment',
    width: 1360,
    height: 900,
    minWidth: 820,
    minHeight: 740,
    useContentSize: true,
    show: !capture,
    backgroundColor: '#101519',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  })
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const errors = []
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      errors.push(details.message)
      console.error(details.message)
    }
  })
  app.on('window-all-closed', () => app.quit())
  await window.loadFile(path.join(__dirname, 'index.html'))
  if (!capture) {
    await window.webContents.executeJavaScript('window.lab.ready')
    window.show()
    window.focus()
    console.log('Interactive 3D controls ready.')
    return
  }
  const timeout = setTimeout(() => {
    console.error('Capture timed out')
    app.exit(1)
  }, 90000)
  try {
    const run = (script) => window.webContents.executeJavaScript(script)
    await run('window.lab.ready')
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const checks = []
    function check(ok, message) {
      if (!ok) throw new Error(message)
      checks.push(message)
    }
    const projection = await run('window.lab.projection()')
    check(
      projection.type === 'OrthographicCamera',
      'Camera uses parallel orthographic projection'
    )
    check(
      Math.abs(projection.direction[0]) < 1e-10 &&
        Math.abs(projection.direction[1] + 1) < 1e-10 &&
        Math.abs(projection.direction[2]) < 1e-10,
      'Camera is locked directly overhead'
    )
    check(
      projection.probes.every(([a, b]) =>
        a.every((v, i) => Math.abs(v - b[i]) < 1e-10)
      ),
      'Depth causes no center-camera perspective on either side'
    )
    check(
      JSON.stringify(projection.positions) ===
        JSON.stringify({ endTurn: [6.35, 0, -0.5], heroPower: [2, 0, 2.7] }),
      'Control positions match the game table layout'
    )
    const viewport = await run(
      `(() => { const r = document.getElementById('viewport').getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })()`
    )
    const frames = {}
    const nextFrames = () =>
      run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
    const waitFor = (condition) =>
      run(`new Promise((resolve, reject) => {
      const deadline = performance.now() + 5000;
      function poll() {
        if (${condition}) resolve();
        else if (performance.now() > deadline) reject(Error('Animation did not reach expected state'));
        else requestAnimationFrame(poll);
      }
      requestAnimationFrame(poll);
    })`)
    async function screenshot(name) {
      await nextFrames()
      await pause(120)
      const png = (await window.webContents.capturePage()).toPNG()
      fs.writeFileSync(path.join(output, `${name}.png`), png)
      frames[name] = png
    }
    await screenshot('01-ready')
    await run(`window.lab.pose('endTurn', 'ENDTURN_WAITING', 0.16)`)
    await screenshot('02-end-turn-mid-flip')
    await run(
      `window.lab.pose('endTurn', 'ENDTURN_WAITING', 1); window.lab.pose('heroPower', 'HeroPower_Used', 0.17)`
    )
    await screenshot('03-hero-power-mid-flip')
    await run(`window.lab.pose('heroPower', 'HeroPower_Used', 1)`)
    await screenshot('04-exhausted')
    await run('window.lab.reset()')
    await nextFrames()

    async function pointerEvent(type, point, buttons = 0) {
      await run(`(() => {
        const target = document.elementFromPoint(${point.x}, ${point.y}) || window;
        target.dispatchEvent(new PointerEvent('${type}', {bubbles: true, clientX: ${point.x}, clientY: ${point.y}, button: 0, buttons: ${buttons}}));
      })()`)
    }
    const endPoint = (await run('window.lab.points()')).endTurn
    await pointerEvent('pointermove', endPoint)
    await pointerEvent('pointerdown', endPoint, 1)
    await screenshot('06-end-turn-held')
    let end = (await run('window.lab.state()')).endTurn
    check(
      end.held &&
        !end.used &&
        Math.abs(end.pressPosition[1] + 0.2) < 1e-6 &&
        Math.abs(end.position[1]) < 1e-6 &&
        Math.abs(Math.abs(end.quaternion[3]) - 1) < 1e-6,
      'Holding end turn lowers ButtonContainer by 0.2 source units without flipping ButtonMesh'
    )
    // The input handler starts the turn immediately, without awaiting release.
    await pointerEvent('pointerup', endPoint)
    end = (await run('window.lab.state()')).endTurn
    check(
      !end.held && end.used && end.busy,
      'Mouse-up starts the turn transition immediately'
    )
    await waitFor('!window.lab.state().endTurn.busy')
    end = (await run('window.lab.state()')).endTurn
    check(
      Math.abs(end.pressPosition[1]) < 1e-6 && Math.abs(end.position[1] + 0.33) < 1e-6,
      'Release returns the parent to zero and the flip settles the child at its source waiting height'
    )

    const source = JSON.parse(
      fs.readFileSync(
        path.join(root, 'assets/experiments/3d-controls/controls.json'),
        'utf8'
      )
    )
    const downDuration = source.clips.ENDTURN_PRESSED_DOWN.duration
    const upDuration = source.clips.ENDTURN_PRESSED_UP.duration
    await run(`window.lab.sequencePose(${downDuration / 2})`)
    end = (await run('window.lab.state()')).endTurn
    check(
      Math.abs(end.pressPosition[1] + 0.1) < 1e-6 &&
        Math.abs(Math.abs(end.quaternion[3]) - 1) < 1e-6,
      'Timeline includes the original linear press-down before release'
    )
    await run(`window.lab.sequencePose(${downDuration + upDuration / 2})`)
    await screenshot('07-end-turn-release-overlap')
    end = (await run('window.lab.state()')).endTurn
    const { evaluate } = await import('./curves.mjs')
    const upTrack = source.clips.ENDTURN_PRESSED_UP.tracks.find(
      (t) => t.path === '' && t.property === 'position'
    )
    check(
      Math.abs(end.pressPosition[1] - evaluate(upTrack.keys, upDuration / 2)[1]) <
        1e-6 && Math.abs(end.quaternion[0]) > 0.01,
      'Original cubic release and mesh rotation run simultaneously on separate nodes'
    )
    await run(`window.lab.sequencePose(${downDuration + 0.3})`)
    end = (await run('window.lab.state()')).endTurn
    check(
      Math.abs(end.pressPosition[1]) < 1e-6 && end.position[1] > 0,
      'The original flip retains its authored lift before settling'
    )
    await run('window.lab.reset()')
    await nextFrames()
    await pointerEvent('pointerdown', endPoint, 1)
    await nextFrames()
    const away = { x: viewport.x + 20, y: viewport.y + 20 }
    await pointerEvent('pointermove', away, 1)
    await pointerEvent('pointerup', away)
    await waitFor('Math.abs(window.lab.state().endTurn.pressPosition[1]) < 1e-6')
    end = (await run('window.lab.state()')).endTurn
    check(
      !end.held && !end.used && !end.busy && Math.abs(end.pressPosition[1]) < 1e-6,
      'Dragging off and releasing raises the button without ending the turn'
    )
    await pointerEvent('pointerdown', endPoint, 1)
    await nextFrames()
    await pointerEvent('pointercancel', endPoint)
    await waitFor('Math.abs(window.lab.state().endTurn.pressPosition[1]) < 1e-6')
    end = (await run('window.lab.state()')).endTurn
    check(
      !end.held && !end.used && Math.abs(end.pressPosition[1]) < 1e-6,
      'A cancelled pointer restores the press without changing turns'
    )
    await run("document.getElementById('end-flip').click()")
    await nextFrames()
    await run(
      "document.getElementById('end-replay').click(); document.getElementById('scrub').value = 50; document.getElementById('scrub').dispatchEvent(new Event('input'))"
    )
    end = (await run('window.lab.state()')).endTurn
    await nextFrames()
    check(
      end.pressPosition[1] < 0 &&
        Math.abs(Math.abs(end.quaternion[3]) - 1) < 1e-6 &&
        JSON.stringify(end) ===
          JSON.stringify((await run('window.lab.state()')).endTurn),
      'Keyboard activation and replay include a scrubbable, paused press phase'
    )
    await run('window.lab.reset()')
    await nextFrames()

    async function clickObject(id) {
      const point = (await run('window.lab.points()'))[id]
      await run(`(() => {
        const target = document.elementFromPoint(${point.x}, ${point.y});
        for (const type of ['pointermove', 'pointerdown', 'pointerup'])
          target.dispatchEvent(new PointerEvent(type, {bubbles: true, clientX: ${point.x}, clientY: ${point.y}, button: 0}));
      })()`)
      await waitFor(`!window.lab.state()[${JSON.stringify(id)}].busy`)
    }
    for (const id of ['endTurn', 'heroPower']) {
      await clickObject(id)
      let state = (await run('window.lab.state()'))[id]
      check(
        state.used && !state.busy,
        `${id}: clicking the actual mesh completes the forward flip`
      )
      await clickObject(id)
      state = (await run('window.lab.state()'))[id]
      check(
        !state.used && !state.busy,
        `${id}: clicking again completes the restore flip`
      )
    }
    await run(
      `document.getElementById('hero-replay').click(); document.getElementById('scrub').value=400; document.getElementById('scrub').dispatchEvent(new Event('input'))`
    )
    const paused = await run('window.lab.state().heroPower.quaternion')
    await pause(300)
    check(
      JSON.stringify(paused) ===
        JSON.stringify(await run('window.lab.state().heroPower.quaternion')),
      'Timeline scrubbing pauses the animation'
    )
    await run(`document.getElementById('reset').click()`)
    check(
      Object.values(await run('window.lab.state()')).every((c) => !c.used && !c.busy),
      'Reset returns both controls to ready'
    )
    const { PNG } = require('pngjs')
    const ready = PNG.sync.read(frames['01-ready'])
    for (const name of [
      '02-end-turn-mid-flip',
      '03-hero-power-mid-flip',
      '04-exhausted'
    ]) {
      const frame = PNG.sync.read(frames[name])
      let changed = 0
      // Compare only the table viewport, excluding labels and controls.
      for (
        let y = Math.ceil(viewport.y);
        y < Math.floor(viewport.y + viewport.height);
        y++
      )
        for (
          let x = Math.ceil(viewport.x);
          x < Math.floor(viewport.x + viewport.width);
          x++
        ) {
          const i = (y * frame.width + x) * 4
          if (
            Math.abs(frame.data[i] - ready.data[i]) +
              Math.abs(frame.data[i + 1] - ready.data[i + 1]) +
              Math.abs(frame.data[i + 2] - ready.data[i + 2]) >
            35
          )
            changed++
        }
      check(changed > 500, `${name}: visible 3D pixels differ (${changed})`)
    }
    window.setContentSize(1000, 800)
    await screenshot('05-resized-table')
    check(
      JSON.stringify((await run('window.lab.projection()')).positions) ===
        JSON.stringify(projection.positions),
      'Resizing preserves placement on the table'
    )
    await clickObject('endTurn')
    check(
      (await run('window.lab.state()')).endTurn.used,
      'Mesh remains clickable after resizing'
    )
    check(errors.length === 0, 'No renderer errors')
    const report = {
      checks,
      renderer: await run('window.lab.diagnostics()'),
      screenshots: Object.keys(frames)
    }
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n'
    )
    console.log(JSON.stringify(report, null, 2))
    clearTimeout(timeout)
    app.exit(0)
  } catch (error) {
    clearTimeout(timeout)
    console.error(error)
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ error: error.message, rendererErrors: errors }, null, 2)
    )
    app.exit(1)
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
  if (process.versions.electron) require('electron').app.exit(1)
})
