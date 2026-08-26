import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../assets/icon.png?asset'
import { DeckRepository } from './services/deck-repository'
import { registerDeckIpc } from './services/deck-ipc'
import { installSceneMenu } from './menu/dev-menu'

const WINDOW_WIDTH = 1920
const WINDOW_HEIGHT = 1080
/**
 * Keep the native menu bar visible for development and testing.
 * Set this to false for the release build to restore Alt-to-reveal behavior.
 */
const KEEP_NATIVE_MENU_BAR_VISIBLE = true

function isAllowedExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function openExternalUrl(url: string): void {
  if (!isAllowedExternalUrl(url)) return

  void shell.openExternal(url).catch((error: unknown) => {
    console.error('Failed to open external URL:', error)
  })
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    minimizable: true,
    show: false,
    autoHideMenuBar: !KEEP_NATIVE_MENU_BAR_VISIBLE,
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep Pixi animations and timers active while the game window is
      // backgrounded or minimized. This deliberately trades power use for
      // uninterrupted game presentation.
      backgroundThrottling: false,
      webSecurity: true
    }
  })

  mainWindow.setMenuBarVisibility(KEEP_NATIVE_MENU_BAR_VISIBLE)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalUrl(url)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

void app
  .whenReady()
  .then(() => {
    electronApp.setAppUserModelId('com.hsinspired.app')

    registerDeckIpc(new DeckRepository(join(app.getPath('userData'), 'decks.json')))

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const mainWindow = createWindow()
    installSceneMenu(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error: unknown) => {
    console.error('Failed to initialize Electron:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
