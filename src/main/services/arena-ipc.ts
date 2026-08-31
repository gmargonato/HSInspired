import { ipcMain } from 'electron'
import {
  ARENA_IPC_CHANNELS,
  parseArenaCardId,
  parseArenaHeroId,
  parseArenaMatchResult,
  parseArenaRunSnapshot
} from '../../shared/ipc/arena'
import { ArenaRepository } from './arena-repository'

export function registerArenaIpc(repository: ArenaRepository): void {
  ipcMain.handle(ARENA_IPC_CHANNELS.get, async () =>
    parseArenaRunSnapshot(await repository.get())
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.selectHero, async (_event, heroId: unknown) =>
    parseArenaRunSnapshot(await repository.selectHero(parseArenaHeroId(heroId)))
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.pickCard, async (_event, cardId: unknown) =>
    parseArenaRunSnapshot(await repository.pickCard(parseArenaCardId(cardId)))
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.retire, async () =>
    parseArenaRunSnapshot(await repository.retire())
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.recordResult, async (_event, result: unknown) =>
    parseArenaRunSnapshot(await repository.recordResult(parseArenaMatchResult(result)))
  )
}
