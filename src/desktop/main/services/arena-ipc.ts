import { ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  ARENA_IPC_CHANNELS,
  parseArenaCardId,
  parseArenaHeroId,
  parseArenaMatchResult,
  parseArenaRunSnapshot,
  parseArenaScoreRequest
} from '../../contracts/ipc/arena'
import { ArenaRepository } from './arena-repository'
import { parseArenaRunId } from '../../contracts/ipc/arena-rewards'

export function registerArenaIpc(repository: ArenaRepository): void {
  if (is.dev)
    ipcMain.handle(ARENA_IPC_CHANNELS.devSetScore, async (_event, request: unknown) =>
      parseArenaRunSnapshot(
        await repository.devSetScore(parseArenaScoreRequest(request))
      )
    )
  ipcMain.handle(ARENA_IPC_CHANNELS.get, async () =>
    parseArenaRunSnapshot(await repository.get())
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.selectHero, async (_event, heroId: unknown) =>
    parseArenaRunSnapshot(await repository.selectHero(parseArenaHeroId(heroId)))
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.pickCard, async (_event, cardId: unknown) =>
    parseArenaRunSnapshot(await repository.pickCard(parseArenaCardId(cardId)))
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.retire, async (_event, runId: unknown) =>
    parseArenaRunSnapshot(await repository.retire(parseArenaRunId(runId)))
  )
  ipcMain.handle(
    ARENA_IPC_CHANNELS.acknowledgeRewards,
    async (_event, runId: unknown) =>
      parseArenaRunSnapshot(await repository.acknowledgeRewards(parseArenaRunId(runId)))
  )
  ipcMain.handle(ARENA_IPC_CHANNELS.recordResult, async (_event, result: unknown) =>
    parseArenaRunSnapshot(await repository.recordResult(parseArenaMatchResult(result)))
  )
}
