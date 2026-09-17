import { ipcMain } from 'electron'
import { is } from '@electron-toolkit/utils'
import {
  PLAYER_STATS_IPC_CHANNELS,
  parsePlayableClassId,
  parsePlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import { PlayerStatsRepository } from './player-stats-repository'
import {
  PROGRESSION_IPC_CHANNELS,
  parseDustRewardRequest,
  parseDustAmount,
  parseProgressionCardId
} from '../../shared/ipc/progression'

/** Registers the narrow player-statistics API exposed to the renderer. */
export function registerPlayerStatsIpc(repository: PlayerStatsRepository): void {
  if (is.dev)
    ipcMain.handle(PROGRESSION_IPC_CHANNELS.devSetDust, (_event, amount: unknown) =>
      repository.setDust(parseDustAmount(amount))
    )
  ipcMain.handle(PROGRESSION_IPC_CHANNELS.get, () => repository.getProgression())
  ipcMain.handle(PROGRESSION_IPC_CHANNELS.reward, (_event, request: unknown) =>
    repository.rewardDust(parseDustRewardRequest(request))
  )
  ipcMain.handle(PROGRESSION_IPC_CHANNELS.upgrade, (_event, cardId: unknown) =>
    repository.changePremium(parseProgressionCardId(cardId), 'upgrade')
  )
  ipcMain.handle(PROGRESSION_IPC_CHANNELS.refund, (_event, cardId: unknown) =>
    repository.changePremium(parseProgressionCardId(cardId), 'refund')
  )
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
