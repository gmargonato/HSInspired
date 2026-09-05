import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../assets/icon.png?asset'
import { DeckRepository } from './services/deck-repository'
import { registerDeckIpc } from './services/deck-ipc'
import {
  WindowSettingsService,
  registerWindowSettingsIpc
} from './services/window-settings-ipc'
import { WindowSettingsRepository } from './services/window-settings-repository'
import { installSceneMenu } from './menu/dev-menu'
import { loadAzureOpenAiConfig } from './services/ai-config'
import { registerAiIpc } from './services/ai-ipc'
import { AzureOpenAiDecisionService } from './services/azure-openai-ai-service'
import { registerPlayerStatsIpc } from './services/player-stats-ipc'
import { PlayerStatsRepository } from './services/player-stats-repository'
import { ArenaRepository } from './services/arena-repository'
import { registerArenaIpc } from './services/arena-ipc'
import { CardClassBuilderRepository } from './services/card-class-builder-repository'
import { registerCardClassBuilderIpc } from './services/card-class-builder-ipc'
import { OutlineTuningRepository } from './services/outline-tuning-repository'
import { registerOutlineTuningIpc } from './services/outline-tuning-ipc'

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

async function createWindow(
  windowSettingsRepository: WindowSettingsRepository
): Promise<BrowserWindow> {
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

  const windowSettings = await WindowSettingsService.create(
    mainWindow,
    windowSettingsRepository
  )
  registerWindowSettingsIpc(mainWindow, windowSettings)

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
  .then(async () => {
    electronApp.setAppUserModelId('com.hsinspired.app')

    const appPath = app.getAppPath()
    if (is.dev) {
      registerCardClassBuilderIpc(
        new CardClassBuilderRepository(
          join(appPath, 'config', 'card-class-colors.json')
        )
      )
      registerOutlineTuningIpc(
        new OutlineTuningRepository(join(appPath, 'config', 'outline-tunings.json'))
      )
    }
    registerAiIpc(
      new AzureOpenAiDecisionService({
        loadConfig: () =>
          loadAzureOpenAiConfig({
            configPath: join(appPath, 'config', 'ai.json'),
            keyPaths: [
              join(appPath, 'config', 'ai-key.local.txt'),
              join(app.getPath('userData'), 'ai-key.local.txt')
            ]
          })
      })
    )
    registerDeckIpc(new DeckRepository(join(app.getPath('userData'), 'decks.json')))
    registerPlayerStatsIpc(
      new PlayerStatsRepository(join(app.getPath('userData'), 'player-stats.json'))
    )
    registerArenaIpc(new ArenaRepository(join(app.getPath('userData'), 'arena.json')))
    const windowSettingsRepository = new WindowSettingsRepository(
      join(app.getPath('userData'), 'window-settings.json')
    )

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const mainWindow = await createWindow(windowSettingsRepository)
    installSceneMenu(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length !== 0) return
      void createWindow(windowSettingsRepository)
        .then(installSceneMenu)
        .catch((error: unknown) => {
          console.error('Failed to recreate the main window:', error)
        })
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
