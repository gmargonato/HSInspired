import { ipcMain } from 'electron'
import {
  PLAYER_STATS_IPC_CHANNELS,
  parsePlayableClassId,
  parsePlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import { PlayerStatsRepository } from './player-stats-repository'

/** Registers the narrow player-statistics API exposed to the renderer. */
export function registerPlayerStatsIpc(repository: PlayerStatsRepository): void {
  ipcMain.handle(PLAYER_STATS_IPC_CHANNELS.get, async () =>
    parsePlayerStatsSnapshot(await repository.get())
  )
  ipcMain.handle(
    PLAYER_STATS_IPC_CHANNELS.recordWin,
    async (_event, classId: unknown) =>
      parsePlayerStatsSnapshot(
        await repository.recordWin(parsePlayableClassId(classId))
      )
  )
  ipcMain.handle(PLAYER_STATS_IPC_CHANNELS.recordTavernBrawlWin, async () =>
    parsePlayerStatsSnapshot(await repository.recordTavernBrawlWin())
  )
}
