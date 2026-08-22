import { app, shell, BrowserWindow, Menu, MenuItem } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../assets/icon.png?asset'
import { SCENE_MENU_ENTRIES, SCENE_REQUEST_CHANNEL } from '../shared/scene-navigation'
import { DeckRepository } from './services/deck-repository'
import { registerDeckIpc } from './services/deck-ipc'

const WINDOW_WIDTH = 1920
const WINDOW_HEIGHT = 1080

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
    autoHideMenuBar: true,
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

/**
 * Adds the developer-only scene switcher to Electron's native application
 * menu. The menu owns no renderer objects; it sends a small typed request
 * through preload, where the renderer resolves the request to a Scene.
 */
function installSceneMenu(mainWindow: BrowserWindow): void {
  if (!is.dev) return

  const applicationMenu = Menu.getApplicationMenu() ?? Menu.buildFromTemplate([])

  if (applicationMenu.getMenuItemById('debug-scenes-menu')) return

  const scenesMenu = new MenuItem({
    id: 'debug-scenes-menu',
    label: 'Scenes',
    submenu: Object.values(SCENE_MENU_ENTRIES).map((entry) => ({
      label: entry.label,
      click: () => {
        // On macOS the app can create a new window after the original one
        // closes while the application menu remains alive. Prefer the active
        // window so the menu does not retain a stale renderer reference.
        const targetWindow =
          BrowserWindow.getFocusedWindow() ??
          BrowserWindow.getAllWindows()[0] ??
          mainWindow
        targetWindow.webContents.send(SCENE_REQUEST_CHANNEL, entry.request)
      }
    }))
  })

  const helpIndex = applicationMenu.items.findIndex(
    (item) => item.role === 'help' || item.label === 'Help'
  )
  const insertionIndex = helpIndex === -1 ? applicationMenu.items.length : helpIndex
  applicationMenu.insert(insertionIndex, scenesMenu)
  Menu.setApplicationMenu(applicationMenu)
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
