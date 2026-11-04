import { ipcMain } from 'electron'
import {
  MATCH_LOG_CHANNELS,
  parseMatchLogId,
  parseMatchLogObject,
  parseMatchLogRecord,
  parseMatchLogStatus
} from '../../contracts/ipc/match-logs'
import type { MatchLogRepository } from './match-log-repository'

export function registerMatchLogIpc(repository: MatchLogRepository): void {
  ipcMain.handle(MATCH_LOG_CHANNELS.start, async (event, metadata: unknown) => {
    const parsed = parseMatchLogObject(metadata)
    return repository.start(event.sender.id, parsed)
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
