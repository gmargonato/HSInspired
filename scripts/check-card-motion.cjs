/** Isolated production card rendering and deterministic motion capture. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp/card-motion')
const runtime = path.join(root, '.tmp/card-motion-runtime')
const smokeView = process.argv.includes('--smoke-view')
const interactive = process.argv.includes('--view') || smokeView
const status = (message) => console.log('[card-motion] ' + message)
async function main() {
  fs.mkdirSync(output, { recursive: true })
  fs.mkdirSync(runtime, { recursive: true })
  const destination = (name) => {
    if (!/^[a-z0-9/-]+$/.test(name)) throw Error('Invalid capture name')
    const filename = path.join(output, name)
    fs.mkdirSync(path.dirname(filename), { recursive: true })
    return filename
  }
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath(
      'userData',
      path.join(runtime, interactive ? 'viewer-profile' : 'electron-profile')
    )
    await app.whenReady()
    const win = new BrowserWindow({
      show: false,
      title: 'Card Motion Viewer',
      width: 1280,
      height: 800,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    app.on('window-all-closed', () => app.quit())
    win.once('ready-to-show', () => {
      if (interactive) {
        win.show()
        win.focus()
      }
    })
    const timeout = setTimeout(
      () => {
        console.error(
          '[card-motion] Timed out waiting for ' +
            (interactive ? 'the viewer to load.' : 'captures.')
        )
        app.exit(1)
      },
      interactive ? 60000 : 300000
    )
    win.webContents.on('did-fail-load', (_, code, description) => {
      console.error(`[card-motion] Window failed to load (${code}): ${description}`)
      app.exit(1)
    })
    win.webContents.on('render-process-gone', (_, details) => {
      console.error('[card-motion] Renderer stopped: ' + details.reason)
      app.exit(1)
    })
    ipcMain.once('viewer-ready', async (_, data) => {
      clearTimeout(timeout)
      status(`Viewer ready: ${data.scenarios} animations. Choose one and press Play.`)
      if (!smokeView) return
      try {
        if (!win.isVisible()) throw Error('Viewer window is hidden')
        const checked = await win.webContents.executeJavaScript(`(async () => {
          const [select] = document.querySelectorAll('select')
          const slider = document.querySelector('input[type=range]')
          const button = document.querySelector('button')
          for (const option of select.options) {
            select.value = option.value
            select.dispatchEvent(new Event('change'))
            slider.value = '0.5'
            slider.dispatchEvent(new Event('input'))
            await new Promise(requestAnimationFrame)
          }
          const insertion = [...select.options].find(option => option.text === 'deck-insertion/local-insert')
          if (insertion) {
            select.value = insertion.value
            select.dispatchEvent(new Event('change'))
            slider.value = '0.85'
            slider.dispatchEvent(new Event('input'))
            const canvas = document.querySelector('canvas')
            const mask = document.querySelector('#slot-mask')
            const guide = document.querySelector('#slot-guide')
            const masked = canvas.toDataURL()
            const time = slider.value
            mask.click()
            if (mask.checked || canvas.toDataURL() === masked || slider.value !== time)
              throw Error('Slot comparison did not change visibility at the same timestamp')
            mask.click()
            guide.click()
            if (!guide.checked || canvas.toDataURL() === masked || slider.value !== time)
              throw Error('Slot boundary guide did not appear at the same timestamp')
            guide.click()
            const ghost = document.querySelector('#slot-ghost')
            ghost.click()
            if (!ghost.checked || canvas.toDataURL() === masked || slider.value !== time)
              throw Error('Hidden portion overlay did not appear at the same timestamp')
            ghost.click()
          }
          select.value = '0'
          select.dispatchEvent(new Event('change'))
          slider.value = '1'
          slider.dispatchEvent(new Event('input'))
          button.click()
          await new Promise(resolve => setTimeout(resolve, 250))
          button.click()
          if (!(Number(slider.value) > 0 && Number(slider.value) < 1))
            throw Error('Play did not restart and advance the animation')
          return select.options.length
        })()`)
        fs.writeFileSync(
          path.join(runtime, 'viewer-smoke.png'),
          (await win.webContents.capturePage()).toPNG()
        )
        status(
          `Viewer check passed: visible window, ${checked} selections, scrubbing, replay and slot controls.`
        )
        app.exit(0)
      } catch (error) {
        console.error(error)
        app.exit(1)
      }
    })
    const captures = []
    ipcMain.handle('capture', async (_, name, region) => {
      let snapshot
      for (let attempt = 0; attempt < 3; attempt++) {
        // Chromium can acknowledge the first RAF before its first canvas is composed.
        // Wait for a painted frame, and reject a blank capture instead of counting it.
        if (!captures.length || attempt)
          await win.webContents.executeJavaScript(
            'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
          )
        snapshot = await win.webContents.capturePage(region)
        const pixels = snapshot.toBitmap()
        if (
          pixels.some((value, i) => i < pixels.length * 0.8 && i % 4 !== 3 && value > 4)
        )
          break
        if (attempt === 2) throw Error('Blank canvas capture: ' + name)
      }
      fs.writeFileSync(destination(name) + '.png', snapshot.toPNG())
      captures.push(name)
    })
    ipcMain.handle('data', (_, name, data) =>
      fs.writeFileSync(destination(name) + '.json', JSON.stringify(data))
    )
    ipcMain.once('result', (_, data) => {
      clearTimeout(timeout)
      if (interactive) {
        console.error('[card-motion] Viewer failed: ' + (data.stack ?? data.error))
        if (smokeView) app.exit(1)
        return
      }
      data.screenshots = captures.length
      const baseline = path.join(root, 'scripts/card-motion-local-baseline.json'),
        current = path.join(output, 'local-draw-current.json')
      if (
        !data.error &&
        !process.argv.some((arg) => arg.startsWith('--set=')) &&
        fs.existsSync(baseline) &&
        fs.existsSync(current)
      ) {
        const before = JSON.parse(fs.readFileSync(baseline, 'utf8')),
          after = JSON.parse(fs.readFileSync(current, 'utf8'))
        data.localDrawLandingMaxError = Math.max(
          ...before.flatMap((frame, i) =>
            frame.time < 1
              ? []
              : frame.corners.map((p, j) =>
                  Math.hypot(p.x - after[i].corners[j].x, p.y - after[i].corners[j].y)
                )
          )
        )
        if (data.localDrawLandingMaxError > 1e-9)
          data.error = 'Local draw hold/landing differs from its preserved baseline'
      }
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(data, null, 2))
      const style =
        '<style>body{background:#171b22;color:#eee;font:16px system-ui;margin:24px}a{color:#9dc7ff}.frames{display:grid;grid-template-columns:repeat(3,minmax(240px,1fr));gap:12px}img{width:100%}figure{margin:0}figcaption{padding:6px}</style>'
      const groups = [...new Set(captures.map((n) => n.split('/')[0]))]
      for (const group of groups) {
        const frames = captures
          .filter((n) => n.startsWith(group + '/'))
          .map((n) => n.slice(group.length + 1))
        const variants = [
          ...new Set(frames.map((n) => n.replace(/-\d+ms(?:-detail)?$/, '')))
        ]
        fs.writeFileSync(
          path.join(output, group, 'index.html'),
          '<!doctype html>' +
            style +
            '<a href="../index.html">All sets</a><h1>' +
            group +
            '</h1><p>Local and remote variants; timestamps are milliseconds. Click a frame for full size.</p>' +
            variants
              .map(
                (variant) =>
                  '<h2>' +
                  variant +
                  '</h2><div class="frames">' +
                  frames
                    .filter((n) => n.replace(/-\d+ms(?:-detail)?$/, '') === variant)
                    .map(
                      (n) =>
                        '<figure><a href="' +
                        n +
                        '.png"><img src="' +
                        n +
                        '.png"></a><figcaption>' +
                        n +
                        '</figcaption></figure>'
                    )
                    .join('') +
                  '</div>'
              )
              .join('')
        )
      }
      fs.writeFileSync(
        path.join(output, 'index.html'),
        '<!doctype html>' +
          style +
          '<h1>Card motion captures</h1><p>Contact sheets grouped by animation. The deck artwork locates the slot; new flights project a rigid full card.</p>' +
          groups
            .map((g) => '<p><a href="' + g + '/index.html">' + g + '</a></p>')
            .join('')
      )
      console.log(JSON.stringify(data))
      if (!interactive) app.exit(data.error ? 1 : 0)
    })
    win.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    await win.loadFile(path.join(runtime, 'index.html'), {
      query: {
        view: String(interactive),
        set: process.argv.find((arg) => arg.startsWith('--set='))?.slice(6) ?? ''
      }
    })
    return
  }
  status(
    interactive
      ? 'Building the interactive viewer...'
      : 'Building hidden screenshot checks... Use --view to open the viewer.'
  )
  await require('esbuild').build({
    entryPoints: [path.join(root, 'scripts/check-card-motion-renderer.ts')],
    outfile: path.join(runtime, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    external: ['electron'],
    plugins: [
      {
        name: 'local-images',
        setup(build) {
          build.onResolve({ filter: /\.(png|jpg|ttf|woff2|otf)(\?url)?$/ }, (args) => ({
            path: args.path.startsWith('@assets/')
              ? path.join(root, 'assets', args.path.slice(8).replace('?url', ''))
              : path.resolve(args.resolveDir, args.path.replace('?url', '')),
            namespace: 'asset-url'
          }))
          build.onLoad({ filter: /.*/, namespace: 'asset-url' }, (args) => ({
            contents:
              'export default ' +
              JSON.stringify(require('node:url').pathToFileURL(args.path).href),
            loader: 'js'
          }))
        }
      }
    ],
    alias: { '@assets': path.join(root, 'assets') },
    define: { 'import.meta.env.DEV': 'true', 'import.meta.glob': '__noArtwork' },
    banner: { js: 'const __noArtwork=()=>({});' },
    logLevel: 'error'
  })
  fs.writeFileSync(
    path.join(runtime, 'index.html'),
    '<!doctype html><html><head><title>Card Motion Viewer</title></head><body style="margin:0;background:#161b22;color:white;font:16px sans-serif"><p id="startup" style="padding:16px">Loading card motion viewer...</p><script src="renderer.js"></script></body></html>'
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  status(
    interactive ? 'Opening Card Motion Viewer...' : 'Capturing animation frames...'
  )
  const child = require('node:child_process').spawn(
    require('electron'),
    [__filename, ...process.argv.slice(2)],
    { cwd: root, env, stdio: 'inherit', windowsHide: !interactive }
  )
  child.on('error', (error) => {
    console.error(error)
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? 1
    if (process.exitCode)
      console.error(`[card-motion] Electron exited with ${signal ?? code}.`)
  })
}
main().catch((error) => {
  console.error(error)
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
