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
let cachedCollectibleMode: CollectibleMode = 'collectible'
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

  const collectionSubmenu: Electron.MenuItemConstructorOptions[] = [
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
    }
  ]

  const deckTrackerSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'By Cost (Default)',
      click: () =>
        sendDevCommand(mainWindow, {
          type: 'game:set-deck-tracker',
          visibility: 'local',
          sortMode: 'cost'
        })
    },
    {
      label: 'Alphabetically',
      click: () =>
        sendDevCommand(mainWindow, {
          type: 'game:set-deck-tracker',
          visibility: 'local',
          sortMode: 'alphabetical'
        })
    },
    {
      label: 'Reveal Shuffle Order',
      click: () =>
        sendDevCommand(mainWindow, {
          type: 'game:set-deck-tracker',
          visibility: 'local',
          sortMode: 'draw-order'
        })
    },
    { type: 'separator' },
    {
      label: 'Hide',
      click: () =>
        sendDevCommand(mainWindow, {
          type: 'game:set-deck-tracker',
          visibility: 'hidden',
          sortMode: 'cost'
        })
    }
  ]

  const playerSubmenu = (
    target: 'local' | 'remote',
    includeDeckTracker: boolean
  ): Electron.MenuItemConstructorOptions[] => {
    const submenu: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'Destroy Deck',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'game:modify-deck',
            target,
            action: 'destroy'
          })
      },
      {
        label: 'Refill Deck',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'game:modify-deck',
            target,
            action: 'refill'
          })
      },
      {
        label: 'Draw Card',
        click: () => sendDevCommand(mainWindow, { type: 'game:draw', target })
      },
      { type: 'separator' },
      {
        label: 'Mana',
        submenu: Array.from({ length: 11 }, (_, value) => ({
          label: `Full ${value}/${value}`,
          click: () =>
            sendDevCommand(mainWindow, {
              type: 'game:set-mana',
              target,
              available: value,
              maximum: value
            })
        }))
      },
      {
        label: 'Hero Health',
        submenu: [1, 5, 10, 15, 20, 25, 30].map((health) => ({
          label: `${health}`,
          click: () =>
            sendDevCommand(mainWindow, { type: 'game:set-hero', target, health })
        }))
      },
      {
        label: 'Armor',
        submenu: [0, 1, 5, 10, 20, 30].map((armor) => ({
          label: `${armor}`,
          click: () =>
            sendDevCommand(mainWindow, { type: 'game:set-hero', target, armor })
        }))
      },
      {
        label: 'Hero Attack',
        submenu: [0, 1, 2, 5, 10].map((attack) => ({
          label: `${attack}`,
          click: () =>
            sendDevCommand(mainWindow, { type: 'game:set-hero', target, attack })
        }))
      },
      {
        label: 'Hero Power',
        submenu: [
          {
            label: 'Reset Availability',
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'game:set-hero-power',
                target,
                action: 'reset'
              })
          },
          {
            label: 'Consume Availability',
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'game:set-hero-power',
                target,
                action: 'consume'
              })
          },
          {
            label: 'Set Cost',
            submenu: Array.from({ length: 11 }, (_, cost) => ({
              label: `${cost}`,
              click: () =>
                sendDevCommand(mainWindow, {
                  type: 'game:set-hero-power',
                  target,
                  cost
                })
            }))
          }
        ]
      },
      {
        label: 'Weapon',
        submenu: [
          {
            label: 'Remove Weapon',
            click: () =>
              sendDevCommand(mainWindow, { type: 'game:remove-weapon', target })
          }
        ]
      },
      {
        label: 'Set Next Fatigue',
        submenu: [1, 2, 5, 10].map((nextDamage) => ({
          label: `${nextDamage}`,
          click: () =>
            sendDevCommand(mainWindow, {
              type: 'game:set-fatigue',
              target,
              nextDamage
            })
        }))
      },
      { type: 'separator' },
      {
        label: 'Add Card to Hand…',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'game:open-card-picker',
            target,
            action: 'add-to-hand'
          })
      },
      {
        label: 'Summon Minion…',
        click: () =>
          sendDevCommand(mainWindow, {
            type: 'game:open-card-picker',
            target,
            action: 'summon'
          })
      },
      {
        label: 'Clear Hand',
        click: () =>
          sendDevCommand(mainWindow, { type: 'game:clear-zone', target, zone: 'hand' })
      },
      {
        label: 'Clear Board',
        click: () =>
          sendDevCommand(mainWindow, { type: 'game:clear-zone', target, zone: 'board' })
      }
    ]

    if (includeDeckTracker) {
      submenu.push(
        { type: 'separator' },
        { label: 'Deck Tracker', submenu: deckTrackerSubmenu }
      )
    }

    return submenu
  }

  const matchSubmenu: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'End Match',
      enabled: isGame,
      submenu: [
        {
          label: 'Win',
          click: () =>
            sendDevCommand(mainWindow, { type: 'game:end-match', outcome: 'win' })
        },
        {
          label: 'Lose',
          click: () =>
            sendDevCommand(mainWindow, { type: 'game:end-match', outcome: 'lose' })
        }
      ]
    },
    {
      label: 'Local Player',
      enabled: isGame,
      submenu: playerSubmenu('local', true)
    },
    {
      label: 'Remote Player',
      enabled: isGame,
      submenu: playerSubmenu('remote', false)
    }
  ]

  return new MenuItem({
    id: 'debug-options-menu',
    label: 'Options',
    submenu: [
      { label: 'Collection', submenu: collectionSubmenu },
      { label: 'Match', submenu: matchSubmenu }
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

  // Keep useful native items while omitting the unused File, Edit, and Help menus.
  const nonDebugItems = [...oldMenu.items].filter(
    (item) =>
      item.id !== 'debug-scenes-menu' &&
      item.id !== 'debug-options-menu' &&
      item.role !== 'fileMenu' &&
      item.role !== 'editMenu' &&
      item.role !== 'help' &&
      item.label !== 'File' &&
      item.label !== 'Edit' &&
      item.label !== 'Help'
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
