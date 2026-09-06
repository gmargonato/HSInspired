import { ipcMain } from 'electron'
import {
  MATCH_LOG_CHANNELS,
  parseMatchLogId,
  parseMatchLogObject,
  parseMatchLogRecord,
  parseMatchLogStatus
} from '../../shared/ipc/match-logs'
import type { MatchLogRepository } from './match-log-repository'
import type { JsonObject } from '../../shared/ipc/ai'

export function registerMatchLogIpc(
  repository: MatchLogRepository,
  settings?: () => Promise<JsonObject>
): void {
  ipcMain.handle(MATCH_LOG_CHANNELS.start, async (event, metadata: unknown) => {
    const parsed = parseMatchLogObject(metadata)
    const aiConfig = await settings?.().catch(() => ({ unavailable: true }))
    return repository.start(event.sender.id, {
      ...parsed,
      ...(aiConfig ? { aiConfig } : {})
    })
  })
  ipcMain.handle(
    MATCH_LOG_CHANNELS.append,
    (event, value: unknown, record: unknown) => {
      const id = parseMatchLogId(value)
      repository.assertOwner(id, event.sender.id)
      return repository
        .append(id, parseMatchLogRecord(record))
        .then(() => repository.assertHealthy(id))
    }
  )
  ipcMain.handle(
    MATCH_LOG_CHANNELS.finish,
    (event, value: unknown, status: unknown) => {
      const id = parseMatchLogId(value)
      repository.assertOwner(id, event.sender.id)
      return repository.finish(id, parseMatchLogStatus(status))
    }
  )
}
