/** Isolated production-control WebGL checks; no player profile or game server. */
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const output = path.join(root, '.tmp', 'match-controls-check')

async function main() {
  fs.mkdirSync(output, { recursive: true })
  if (process.versions.electron) {
    const { app, BrowserWindow, ipcMain } = require('electron')
    app.setPath('userData', path.join(output, 'electron-profile'))
    await app.whenReady()
    const window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      useContentSize: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
        backgroundThrottling: false
      }
    })
    const timer = setTimeout(() => app.exit(1), 120000)
    ipcMain.handle('capture', async (_, name) =>
      fs.writeFileSync(
        path.join(output, name + '.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    )
    ipcMain.once('result', (_, result) => {
      clearTimeout(timer)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(result, null, 2)
      )
      console.log(JSON.stringify(result))
      app.exit(result.error ? 1 : 0)
    })
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(details.message)
    })
    await window.loadFile(path.join(output, 'index.html'))
    return
  }
  const source = fs.readFileSync(
    path.join(root, 'scripts/check-match-controls-renderer.ts'),
    'utf8'
  )
  await require('esbuild').build({
    stdin: { contents: source, loader: 'ts', resolveDir: path.join(root, 'scripts') },
    outfile: path.join(output, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    external: ['electron'],
    loader: {
      '.png': 'dataurl',
      '.jpg': 'dataurl',
      '.woff2': 'dataurl',
      '.ttf': 'dataurl'
    },
    alias: { '@assets': path.join(root, 'assets') },
    plugins: [
      {
        name: 'asset-urls',
        setup(build) {
          build.onResolve({ filter: /\?url$/ }, (args) => ({
            path: require('node:url').pathToFileURL(
              path.join(
                root,
                args.path.replace('@assets/', 'assets/').replace('?url', '')
              )
            ).href,
            external: true
          }))
        }
      }
    ],
    define: {
      'import.meta.env.DEV': 'true',
      'import.meta.glob': '__unusedCardArtwork'
    },
    banner: { js: 'const __unusedCardArtwork = () => ({});' },
    logLevel: 'error'
  })
  fs.writeFileSync(
    path.join(output, 'index.html'),
    '<!doctype html><body style="margin:0;overflow:hidden"><style>canvas{width:1280px;height:720px;display:block}</style><script src="renderer.js"></script>'
  )
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(require('electron'), [__filename], {
    cwd: root,
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
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
