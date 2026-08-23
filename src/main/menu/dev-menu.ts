import { BrowserWindow, Menu, MenuItem, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  SCENE_MENU_ENTRIES,
  SCENE_REQUEST_CHANNEL
} from '../../shared/scene-navigation'
import {
  DEV_COLLECTIBLE_SYNC_CHANNEL,
  DEV_COMMAND_CHANNEL,
  DEV_DECK_SYNC_CHANNEL,
  DEV_SCENE_CHANGED_CHANNEL,
  isCollectibleMode,
  isDevDeckSyncPayload,
  isDevSceneId,
  type CollectibleMode,
  type DevCommand,
  type DevDeckEntry,
  type DevSceneId
} from '../../shared/dev-menu'

let cachedDevDecks: readonly DevDeckEntry[] = []
let cachedMainWindow: BrowserWindow | null = null
let cachedCurrentSceneId: DevSceneId = 'unknown'
let cachedCollectibleMode: CollectibleMode = 'all'
let devDeckSyncHandlerInstalled = false
let devSceneChangedHandlerInstalled = false
let devCollectibleSyncHandlerInstalled = false

function sendSceneRequest(
  mainWindow: BrowserWindow,
  request: (typeof SCENE_MENU_ENTRIES)[keyof typeof SCENE_MENU_ENTRIES]['request']
): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? mainWindow
  targetWindow.webContents.send(SCENE_REQUEST_CHANNEL, request)
}

function sendDevCommand(mainWindow: BrowserWindow, command: DevCommand): void {
  const targetWindow =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? mainWindow
  targetWindow.webContents.send(DEV_COMMAND_CHANNEL, command)
}

function buildScenesMenu(mainWindow: BrowserWindow): MenuItem {
  const staticEntries = Object.entries(SCENE_MENU_ENTRIES).filter(
    ([id]) => id !== 'game'
  )

  const staticItems = staticEntries.map(([, entry]) => ({
    label: entry.label,
    click: () => sendSceneRequest(mainWindow, entry.request)
  }))

  const matchSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: SCENE_MENU_ENTRIES.game.label,
      click: () => sendSceneRequest(mainWindow, SCENE_MENU_ENTRIES.game.request)
    },
    { type: 'separator' }
  ]

  if (cachedDevDecks.length === 0) {
    matchSubmenu.push({ label: 'No complete deck', enabled: false })
  } else {
    for (const deck of cachedDevDecks) {
      matchSubmenu.push({
        label: `${deck.id} — ${deck.classId}`,
        click: () => {
          const targetWindow =
            BrowserWindow.getFocusedWindow() ??
            BrowserWindow.getAllWindows()[0] ??
            mainWindow
          targetWindow.webContents.send(SCENE_REQUEST_CHANNEL, {
            id: 'game',
            params: { deckId: deck.id }
          })
        }
      })
    }
  }

  return new MenuItem({
    id: 'debug-scenes-menu',
    label: 'Scenes',
    submenu: [
      ...staticItems,
      { type: 'separator' } as const,
      { label: 'Match', submenu: matchSubmenu }
    ]
  })
}

function buildOptionsMenu(mainWindow: BrowserWindow): MenuItem {
  const isCollection = cachedCurrentSceneId === 'collection'
  const isGame = cachedCurrentSceneId === 'game'
  return new MenuItem({
    id: 'debug-options-menu',
    label: 'Options',
    submenu: [
      {
        label: 'Show Collectible Only',
        type: 'radio',
        enabled: isCollection,
        checked: cachedCollectibleMode === 'collectible',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'collection:set-collectible',
            mode: 'collectible'
          })
      },
      {
        label: 'Show Uncollectible Only',
        type: 'radio',
        enabled: isCollection,
        checked: cachedCollectibleMode === 'uncollectible',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'collection:set-collectible',
            mode: 'uncollectible'
          })
      },
      {
        label: 'Show All',
        type: 'radio',
        enabled: isCollection,
        checked: cachedCollectibleMode === 'all',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'collection:set-collectible',
            mode: 'all'
          })
      },
      { type: 'separator' },
      {
        label: 'Add Card to Hand…',
        enabled: isGame,
        click: () => sendDevCommand(mainWindow, { type: 'game:open-add-card-picker' })
      },
      {
        label: 'Set Mana',
        enabled: isGame,
        submenu: Array.from({ length: 11 }, (_, value) => ({
          label: `${value}/10`,
          click: () =>
            sendDevCommand(mainWindow, {
              type: 'game:set-mana',
              available: value,
              maximum: value
            })
        }))
      },
      {
        label: 'Deck Tracker',
        type: 'checkbox',
        enabled: isGame,
        checked: false,
        click: () => sendDevCommand(mainWindow, { type: 'game:toggle-tracker' })
      }
    ]
  })
}

function rebuildAllDevMenus(): void {
  if (!cachedMainWindow || !is.dev) return
  const oldMenu = Menu.getApplicationMenu()
  const scenesMenu = buildScenesMenu(cachedMainWindow)
  const optionsMenu = buildOptionsMenu(cachedMainWindow)

  if (!oldMenu) {
    const newMenu = new Menu()
    newMenu.append(scenesMenu)
    newMenu.append(optionsMenu)
    Menu.setApplicationMenu(newMenu)
    return
  }

  // Collect non-debug items to preserve Edit/View/Window/Help etc.
  const nonDebugItems = [...oldMenu.items].filter(
    (item) => item.id !== 'debug-scenes-menu' && item.id !== 'debug-options-menu'
  )
  const helpIndex = nonDebugItems.findIndex(
    (item) => item.role === 'help' || item.label === 'Help'
  )
  const newMenu = new Menu()
  let inserted = false
  for (let index = 0; index < nonDebugItems.length; index += 1) {
    if (index === helpIndex) {
      newMenu.append(scenesMenu)
      newMenu.append(optionsMenu)
      inserted = true
    }
    newMenu.append(nonDebugItems[index]!)
  }
  if (!inserted) {
    newMenu.append(scenesMenu)
    newMenu.append(optionsMenu)
  }
  Menu.setApplicationMenu(newMenu)
}

function rebuildScenesMenu(): void {
  rebuildAllDevMenus()
}

function rebuildOptionsMenu(): void {
  rebuildAllDevMenus()
}

function installDevDeckSyncHandler(): void {
  if (devDeckSyncHandlerInstalled) return
  devDeckSyncHandlerInstalled = true
  ipcMain.on(DEV_DECK_SYNC_CHANNEL, (_event, payload: unknown) => {
    if (!isDevDeckSyncPayload(payload)) return
    cachedDevDecks = payload
    rebuildScenesMenu()
  })
}

function installDevSceneChangedHandler(): void {
  if (devSceneChangedHandlerInstalled) return
  devSceneChangedHandlerInstalled = true
  ipcMain.on(DEV_SCENE_CHANGED_CHANNEL, (_event, payload: unknown) => {
    if (!isDevSceneId(payload)) return
    cachedCurrentSceneId = payload
    rebuildOptionsMenu()
  })
}

function installCollectibleSyncHandler(): void {
  if (devCollectibleSyncHandlerInstalled) return
  devCollectibleSyncHandlerInstalled = true
  ipcMain.on(DEV_COLLECTIBLE_SYNC_CHANNEL, (_event, payload: unknown) => {
    if (!isCollectibleMode(payload)) return
    cachedCollectibleMode = payload
    rebuildOptionsMenu()
  })
}

/**
 * Adds the developer-only scene switcher to Electron's native application
 * menu. The menu owns no renderer objects; it sends a small typed request
 * through preload, where the renderer resolves the request to a Scene.
 *
 * The `Match` entry is a submenu populated from the renderer-pushed deck list
 * (Deck ID — Class). This keeps the renderer as the source of truth for
 * completeness while the main process only renders the menu.
 *
 * The `Options` menu is context-aware: its items are enabled only for the
 * scene reported by the renderer via `DEV_SCENE_CHANGED_CHANNEL`.
 */
export function installSceneMenu(mainWindow: BrowserWindow): void {
  if (!is.dev) return

  cachedMainWindow = mainWindow
  installDevDeckSyncHandler()
  installDevSceneChangedHandler()
  installCollectibleSyncHandler()

  rebuildAllDevMenus()
}
