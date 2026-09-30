import type { JsonObject } from '../../../desktop/contracts/ipc/ai'
import type {
  MatchLogsApi,
  MatchLogStream,
  MatchLogStatus
} from '../../../desktop/contracts/ipc/match-logs'
import type { RendererLogger } from '../../../application/contracts/logger'

export function logObject(value: unknown): JsonObject {
  return value as JsonObject
}

/** Captures values immediately, then lets main serialize disk writes off the game loop. */
export class MatchRecorder {
  readonly ready: Promise<string | undefined>
  private failed = false
  private finished = false
  private matchId?: string
  private context: () => { revision: number; turnNumber: number } = () => ({
    revision: 0,
    turnNumber: 0
  })
  decisionId?: string

  constructor(
    private readonly api: MatchLogsApi | undefined,
    metadata: JsonObject,
    private readonly reportError: (message: string) => void
  ) {
    this.ready = Promise.resolve()
      .then(() => {
        if (!api) throw new Error('Match logging bridge is unavailable.')
        return api.start(metadata)
      })
      .then((id) => {
        this.matchId = id
        return id
      })
      .catch((error) => {
        this.fail(error)
        return undefined
      })
  }

  setContext(context: () => { revision: number; turnNumber: number }): void {
    this.context = context
  }

  private fail(_error: unknown): void {
    if (this.failed) return
    this.failed = true
    this.reportError(
      'Match logging failed. You can keep playing, but this match recording may be incomplete.'
    )
  }

  record(
    stream: MatchLogStream,
    kind: string,
    data: unknown,
    decisionId = this.decisionId
  ): void {
    if (this.failed) return
    try {
      const record = {
        stream,
        kind,
        timestamp: new Date().toISOString(),
        ...this.context(),
        ...(decisionId ? { decisionId } : {}),
        data: logObject(typeof data === 'function' ? data() : data)
      }
      if (this.matchId) {
        // invoke() takes the structured-clone snapshot synchronously in preload.
        void this.api!.append(this.matchId, record).catch((error) => this.fail(error))
      } else {
        // Only startup records need to wait for the log ID.
        const pending = structuredClone(record)
        void this.ready
          .then((id) => (id ? this.api!.append(id, pending) : undefined))
          .catch((error) => this.fail(error))
      }
    } catch (error) {
      this.fail(error)
    }
  }

  finish(status: MatchLogStatus): void {
    if (this.finished) return
    this.finished = true
    void this.ready
      .then((id) => (id ? this.api!.finish(id, status) : undefined))
      .catch((error) => this.fail(error))
  }

  logger(base: RendererLogger): RendererLogger {
    return {
      info: (message, ...details) => {
        base.info(message, ...details)
      },
      warn: (message, ...details) => {
        base.warn(message, ...details)
        if (
          ![
            '[Game AI] failure',
            '[Game AI] action-executed',
            '[Game AI] invariant-error'
          ].includes(message)
        )
          this.record('decisions', 'warning', { message, details })
      },
      error: (message, ...details) => {
        base.error(message, ...details)
        if (
          ![
            '[Game AI] failure',
            '[Game AI] action-executed',
            '[Game AI] invariant-error'
          ].includes(message)
        )
          this.record('decisions', 'error', { message, details })
      }
    }
  }
}
