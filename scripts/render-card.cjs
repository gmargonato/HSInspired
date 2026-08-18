const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')

const runningInElectronApiMode =
  Boolean(process.versions.electron) && process.env.ELECTRON_RUN_AS_NODE !== '1'

if (!runningInElectronApiMode) {
  const electronPath = require('electron')
  const electronEnvironment = { ...process.env }
  delete electronEnvironment.ELECTRON_RUN_AS_NODE

  const userDataDirectory = path.resolve('artifacts', 'card-lab-user-data')
  fs.mkdir(userDataDirectory, { recursive: true })
    .then(() => {
      const child = spawn(
        electronPath,
        [
          '--no-sandbox',
          '--disable-gpu',
          `--user-data-dir=${userDataDirectory}`,
          __filename,
          ...process.argv.slice(2)
        ],
        {
          stdio: 'inherit',
          env: electronEnvironment
        }
      )

      child.on('exit', (code, signal) => {
        if (signal) process.kill(process.pid, signal)
        else process.exit(code ?? 0)
      })
      child.on('error', (error) => {
        console.error(
          'Failed to launch Electron for Card Lab rendering:',
          error.message
        )
        process.exit(1)
      })
    })
    .catch((error) => {
      console.error('Failed to prepare Card Lab Electron profile:', error)
      process.exit(1)
    })
} else {
  const { app, BrowserWindow } = require('electron')

  function readArg(name, fallback) {
    const index = process.argv.indexOf(name)
    return index === -1 ? fallback : process.argv[index + 1]
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
  }

  async function waitForCardLab(window) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const state = await window.webContents.executeJavaScript(
        '({ ready: document.body.dataset.cardLabReady, error: window.cardLabError || "" })'
      )
      if (state.error) throw new Error(state.error)
      if (state.ready === 'true') return
      await wait(50)
    }
    throw new Error('Timed out waiting for the Card Lab renderer')
  }

  async function render() {
    const cardId = readArg('--card-id', 'basic_acidic_swamp_ooze')
    const output = path.resolve(
      readArg('--output', path.join('artifacts', `card-${cardId}.png`))
    )
    const indexPath = path.resolve('dist-card-lab', 'index.html')

    await fs.access(indexPath)
    await fs.mkdir(path.dirname(output), { recursive: true })

    const window = new BrowserWindow({
      width: 900,
      height: 900,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })

    try {
      await window.loadFile(indexPath, {
        query: {
          cardId,
          export: '1'
        }
      })
      await waitForCardLab(window)
      const dataUrl = await window.webContents.executeJavaScript(
        'window.cardLabExport || ""'
      )
      if (!dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('Card Lab did not produce a PNG data URL')
      }

      const base64 = dataUrl.slice('data:image/png;base64,'.length)
      await fs.writeFile(output, Buffer.from(base64, 'base64'))
      console.log(
        JSON.stringify({ cardId, output, bytes: Buffer.byteLength(base64, 'base64') })
      )
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  }

  app
    .whenReady()
    .then(render)
    .then(() => app.quit())
    .catch((error) => {
      console.error(error)
      app.exit(1)
    })
}
