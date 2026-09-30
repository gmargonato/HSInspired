import { BrowserWindow, Menu, MenuItem, ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  DEV_MATCH_MENU_ENTRIES,
  SCENE_MENU_ENTRIES,
  SCENE_REQUEST_CHANNEL,
  type SceneRequest
} from '../contracts/scene-navigation'
import {
  DEV_COLLECTIBLE_SYNC_CHANNEL,
  DEV_PREMIUM_SYNC_CHANNEL,
  DEV_ARENA_SYNC_CHANNEL,
  isDevArenaAvailability,
  isPremiumMode,
  type PremiumMode,
  type DevArenaAvailability,
  DEV_COMMAND_CHANNEL,
  DEV_SCENE_CHANGED_CHANNEL,
  isCollectibleMode,
  isDevSceneId,
  type CollectibleMode,
  type DevCommand,
  type DevSceneId
} from '../contracts/dev-menu'

let cachedMainWindow: BrowserWindow | null = null
let cachedCurrentSceneId: DevSceneId = 'unknown'
let cachedCollectibleMode: CollectibleMode = 'collectible'
let cachedPremiumMode: PremiumMode = 'unlocked'
let cachedArenaAvailability: DevArenaAvailability = { retire: false, scores: false }
let devSceneChangedHandlerInstalled = false
let devOptionSyncHandlerInstalled = false

function sendSceneRequest(mainWindow: BrowserWindow, request: SceneRequest): void {
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

  const matchSubmenu: Electron.MenuItemConstructorOptions[] = Object.values(
    DEV_MATCH_MENU_ENTRIES
  ).map((entry) => ({
    label: entry.label,
    click: () => sendSceneRequest(mainWindow, entry.request)
  }))

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
      {
        label: 'Arcane Dust',
        submenu: [
          {
            label: 'Set custom amount…',
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'progression:set-dust',
                amount: 'custom'
              })
          },
          { type: 'separator' },
          ...[0, 50, 100, 250, 500, 1000, 2000, 5000].map((amount) => ({
            label: `Set to ${amount.toLocaleString('en-US')}`,
            click: () =>
              sendDevCommand(mainWindow, { type: 'progression:set-dust', amount })
          }))
        ]
      },
      {
        label: 'Set Rank',
        submenu: [
          ...[25, 1].map((rank) => ({
            label: `Rank ${rank}`,
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'ranking:set-rank',
                tier: 'rank' as const,
                rank
              })
          })),
          { type: 'separator' },
          {
            label: 'Legend 999',
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'ranking:set-rank',
                tier: 'legend' as const,
                rank: 999
              })
          },
          {
            label: 'Legend 2',
            click: () =>
              sendDevCommand(mainWindow, {
                type: 'ranking:set-rank',
                tier: 'legend' as const,
                rank: 2
              })
          }
        ]
      },
      {
        label: 'Premium',
        submenu: (
          [
            ['unlocked', 'Unlocked'],
            ['all', 'All Cards'],
            ['local', 'Local Player Only'],
            ['remote', 'Remote Player Only']
          ] as const
        ).map(([mode, label]) => ({
          label,
          type: 'radio' as const,
          checked: cachedPremiumMode === mode,
          click: () => sendDevCommand(mainWindow, { type: 'cards:set-premium', mode })
        }))
      },
      {
        label: 'Arena',
        enabled: cachedCurrentSceneId === 'arena',
        submenu: [
          {
            label: 'Retire',
            enabled: cachedArenaAvailability.retire,
            click: () => sendDevCommand(mainWindow, { type: 'arena:retire' })
          },
          ...(['wins', 'defeats'] as const).map((counter) => ({
            label: counter === 'wins' ? 'Set Wins' : 'Set Losses',
            enabled: cachedArenaAvailability.scores,
            submenu: Array.from(
              { length: counter === 'wins' ? 13 : 4 },
              (_, value) => ({
                label: String(value),
                click: () =>
                  sendDevCommand(mainWindow, {
                    type: 'arena:set-score',
                    counter,
                    value
                  })
              })
            )
          }))
        ]
      },
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

function rebuildOptionsMenu(): void {
  rebuildAllDevMenus()
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

function installOptionSyncHandler(): void {
  if (devOptionSyncHandlerInstalled) return
  devOptionSyncHandlerInstalled = true
  ipcMain.on(DEV_PREMIUM_SYNC_CHANNEL, (_event, payload: unknown) => {
    if (!isPremiumMode(payload)) return
    cachedPremiumMode = payload
    rebuildOptionsMenu()
  })
  ipcMain.on(DEV_ARENA_SYNC_CHANNEL, (_event, payload: unknown) => {
    if (!isDevArenaAvailability(payload)) return
    cachedArenaAvailability = payload
    rebuildOptionsMenu()
  })
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
 * The `Match` entry is a fixed three-option development launcher.
 * The renderer remains the source of truth for deck completeness.
 * The renderer selects the first complete deck and constructs the actual route.
 *
 * The `Options` menu is context-aware: its items are enabled only for the
 * scene reported by the renderer via `DEV_SCENE_CHANGED_CHANNEL`.
 */
export function installSceneMenu(mainWindow: BrowserWindow): void {
  if (!is.dev) return

  cachedMainWindow = mainWindow
  installDevSceneChangedHandler()
  installOptionSyncHandler()

  rebuildAllDevMenus()
}
