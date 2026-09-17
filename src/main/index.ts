import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { parseMatchLogObject } from '../shared/ipc/match-logs'
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
import { loadAiConfig } from './services/ai-config'
import { registerAiIpc } from './services/ai-ipc'
import { AiDecisionService } from './services/ai-decision-service'
import { registerPlayerStatsIpc } from './services/player-stats-ipc'
import { PlayerStatsRepository } from './services/player-stats-repository'
import { ArenaRepository } from './services/arena-repository'
import { registerArenaIpc } from './services/arena-ipc'
import { CardClassBuilderRepository } from './services/card-class-builder-repository'
import { registerCardClassBuilderIpc } from './services/card-class-builder-ipc'
import { OutlineTuningRepository } from './services/outline-tuning-repository'
import { MatchLogRepository } from './services/match-log-repository'
import { registerMatchLogIpc } from './services/match-log-ipc'
import { registerOutlineTuningIpc } from './services/outline-tuning-ipc'

const WINDOW_WIDTH = 1920
const WINDOW_HEIGHT = 1080
/**
 * Keep the native menu bar visible for development and testing.
 * Set this to false for the release build to restore Alt-to-reveal behavior.
 */
const KEEP_NATIVE_MENU_BAR_VISIBLE = true
let matchLogs: MatchLogRepository | undefined
let drainingLogs = false
let logsDrained = false

app.on('before-quit', (event) => {
  if (!matchLogs || logsDrained) return
  event.preventDefault()
  if (drainingLogs) return
  drainingLogs = true
  let timer: ReturnType<typeof setTimeout>
  void Promise.race([
    matchLogs.interrupt(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, 5000)
    })
  ]).finally(() => {
    clearTimeout(timer)
    logsDrained = true
    app.quit()
  })
})

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
    const aiService = new AiDecisionService({
      loadConfig: () =>
        loadAiConfig({
          configPath: join(appPath, 'config', 'ai.json'),
          azureKeyPaths: [
            join(appPath, 'config', 'ai-key.local.txt'),
            join(app.getPath('userData'), 'ai-key.local.txt')
          ],
          openRouterKeyPaths: [
            join(appPath, 'config', 'openrouter-key.local.txt'),
            join(app.getPath('userData'), 'openrouter-key.local.txt')
          ]
        })
    })
    matchLogs = new MatchLogRepository(
      is.dev
        ? join(appPath, 'artifacts', 'match-logs')
        : join(app.getPath('userData'), 'match-logs')
    )
    await matchLogs
      .initialize()
      .catch((error) => console.error('Could not initialize match logging:', error))
    registerMatchLogIpc(matchLogs, async () =>
      parseMatchLogObject(await aiService.settings())
    )
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
    registerAiIpc(aiService)
    registerDeckIpc(new DeckRepository(join(app.getPath('userData'), 'decks.json')))
    const playerStatsRepository = new PlayerStatsRepository(
      join(app.getPath('userData'), 'player-stats.json')
    )
    const arenaRepository = new ArenaRepository(
      join(app.getPath('userData'), 'arena.json'),
      playerStatsRepository
    )
    // Recover an interrupted reward credit before any renderer can read progression.
    await arenaRepository.get()
    registerPlayerStatsIpc(playerStatsRepository)
    registerArenaIpc(arenaRepository)
    const windowSettingsRepository = new WindowSettingsRepository(
      join(app.getPath('userData'), 'window-settings.json')
    )

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
      const owner = window.webContents.id
      window.webContents.on('render-process-gone', () => {
        void matchLogs?.interrupt(owner)
      })
      window.webContents.on(
        'did-start-navigation',
        (_event, _url, _inPlace, isMainFrame) => {
          if (isMainFrame) void matchLogs?.interrupt(owner)
        }
      )
      window.on('closed', () => {
        void matchLogs?.interrupt(owner)
      })
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
