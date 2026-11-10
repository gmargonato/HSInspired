import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
  unlink
} from 'node:fs/promises'
import { join } from 'node:path'
import {
  AI_LOG_SCHEMA_VERSION,
  type JsonObject,
  type JsonValue
} from '../../contracts/ipc/ai'
import type { MatchLogRecord, MatchLogStatus } from '../../contracts/ipc/match-logs'
import { MatchLogTranscript } from './match-log-transcript'
import { AiDecisionTranscript } from './ai-decision-transcript'

const FLUSH_INTERVAL_MS = 250
const MAX_PENDING_RECORDS = 256

interface PendingRecord {
  record: MatchLogRecord & { sequence: number }
  resolve: () => void
  reject: (error: unknown) => void
}

interface Recording {
  readonly id: string
  readonly owner: number
  readonly directory: string
  queue: Promise<void>
  sequence: number
  status: 'in-progress' | MatchLogStatus
  recordingIncomplete: boolean
  transcript: MatchLogTranscript
  ai: AiDecisionTranscript
  pending: PendingRecord[]
  timer?: ReturnType<typeof setTimeout>
  flushQueued: boolean
  failure?: string
  failureReported?: boolean
}

/** Defense in depth: never serialize credential-bearing fields or request headers. */
export function serializeMatchLog(value: unknown, pretty = false): string {
  return JSON.stringify(
    value,
    (key, nested) => {
      if (/^(api[-_]?key|authorization|headers|keyPaths|environmentKey)$/i.test(key))
        return undefined
      if (nested instanceof Error) return { name: nested.name, message: nested.message }
      return nested
    },
    pretty ? 2 : undefined
  )
}

// An exact, versioned header lets recovery update status without parsing search prose.
const RECORDING_HEADER =
  /^<!-- hsinspired-ai-decisions:v1 -->\nStatus: (in-progress|completed|abandoned|interrupted)\nRecording incomplete: (yes|no)\n\n/
const INTERRUPTION_MESSAGE =
  'The previous session ended unexpectedly.\nThe match recording may be missing its final events.\n'

function recordingHeader(status: Recording['status'], incomplete: boolean): string {
  return `<!-- hsinspired-ai-decisions:v1 -->\nStatus: ${status}\nRecording incomplete: ${incomplete ? 'yes' : 'no'}\n\n`
}

async function atomicText(
  directory: string,
  name: string,
  text: string
): Promise<void> {
  const target = join(directory, name)
  try {
    await writeFile(target + '.tmp', text, 'utf8')
    await rename(target + '.tmp', target)
  } finally {
    await unlink(target + '.tmp').catch(() => undefined)
  }
}

async function atomicJson(
  directory: string,
  name: string,
  value: unknown
): Promise<void> {
  await atomicText(directory, name, serializeMatchLog(value, true) + '\n')
}

export class MatchLogRepository {
  private readonly recordings = new Map<string, Recording>()

  constructor(private readonly root: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^\d{4}-\d{2}-\d{2}T[\d-]+Z_[a-f0-9-]{36}$/.test(entry.name)
      )
        continue
      const directory = join(this.root, entry.name)
      try {
        let markdown: string | undefined
        try {
          markdown = await readFile(join(directory, 'ai-decisions.md'), 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
        if (markdown !== undefined) {
          const header = markdown.match(RECORDING_HEADER)
          if (!header) throw new Error('Unrecognized AI decisions recording header.')
          if (header[1] === 'in-progress') {
            await appendFile(join(directory, 'match.txt'), '\n' + INTERRUPTION_MESSAGE)
            await atomicText(
              directory,
              'ai-decisions.md',
              markdown.replace(RECORDING_HEADER, recordingHeader('interrupted', true)) +
                '\n' +
                INTERRUPTION_MESSAGE
            )
          }
          // Only discard a stale atomic-write temporary after recognizing its target.
          await unlink(join(directory, 'ai-decisions.md.tmp')).catch(() => undefined)
          continue
        }
        // Historical three-file folders retain their original format and recovery.
        let summary: JsonObject
        try {
          summary = JSON.parse(
            await readFile(join(directory, 'ai.json'), 'utf8')
          ) as JsonObject
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw error
        }
        if (
          (summary.schemaVersion === 4 ||
            summary.schemaVersion === 5 ||
            summary.schemaVersion === 6 ||
            summary.schemaVersion === AI_LOG_SCHEMA_VERSION) &&
          summary.status === 'in-progress'
        ) {
          for (const decision of (summary.decisions ?? []) as JsonObject[]) {
            for (const play of (decision.plays ?? []) as Record<string, JsonValue>[]) {
              if (play.result === 'pending') play.result = 'unknown'
            }
          }
          await appendFile(join(directory, 'match.txt'), '\n' + INTERRUPTION_MESSAGE)
          await atomicJson(directory, 'ai.json', {
            ...summary,
            status: 'interrupted',
            recordingIncomplete: true,
            recoveredAt: new Date().toISOString()
          })
        }
      } catch (error) {
        console.warn('Unable to recover match log summary:', entry.name, error)
      }
    }
  }

  async start(owner: number, metadata: JsonObject): Promise<string> {
    const id = randomUUID()
    const startedAt = Date.now()
    const timestamp = new Date(startedAt).toISOString()
    const directory = join(this.root, `${timestamp.replace(/[:.]/g, '-')}_${id}`)
    await mkdir(directory, { recursive: true })
    const ai = new AiDecisionTranscript(metadata, timestamp)
    await writeFile(
      join(directory, 'match.txt'),
      `Match log\n\nStarted: ${timestamp.replace('T', ' at ').replace('Z', ' UTC')}\n`,
      { flag: 'wx' }
    )
    await writeFile(
      join(directory, 'ai-decisions.md'),
      recordingHeader('in-progress', false) + ai.render(),
      { flag: 'wx' }
    )
    this.recordings.set(id, {
      id,
      owner,
      directory,
      queue: Promise.resolve(),
      sequence: 0,
      status: 'in-progress',
      recordingIncomplete: false,
      transcript: new MatchLogTranscript(),
      ai,
      pending: [],
      flushQueued: false
    })
    return id
  }

  assertOwner(id: string, owner: number): void {
    if (this.get(id).owner !== owner)
      throw new Error('Match log belongs to a different window.')
  }

  assertHealthy(id: string): void {
    const failure = this.get(id).failure
    if (failure) throw new Error(failure)
  }

  private get(id: string): Recording {
    const recording = this.recordings.get(id)
    if (!recording) throw new Error('Unknown match log ID.')
    return recording
  }

  private enqueue(recording: Recording, operation: () => Promise<void>): Promise<void> {
    const result = recording.queue.then(operation)
    recording.queue = result.catch(async () => {
      recording.failure = 'A match log write failed. This recording may be incomplete.'
      recording.recordingIncomplete = true
      await this.writeSummary(recording).catch(() => undefined)
    })
    return result
  }

  append(id: string, input: MatchLogRecord): Promise<void> {
    const recording = this.get(id)
    if (recording.failure) return Promise.reject(new Error(recording.failure))
    const record = input
    if (recording.pending.length >= MAX_PENDING_RECORDS) {
      recording.failure =
        'Match logging backlog exceeded its limit; recording is incomplete.'
      recording.recordingIncomplete = true
      return Promise.reject(new Error(recording.failure))
    }
    // IPC owns its structured-cloned value; decision records are immutable call-time values.
    const result = new Promise<void>((resolve, reject) => {
      recording.pending.push({
        record: { ...record, sequence: ++recording.sequence },
        resolve,
        reject
      })
    })
    if (record.kind === 'command' && record.data.turnEnded === true) {
      void this.flush(recording).catch(() => undefined)
    } else if (!recording.timer && !recording.flushQueued) {
      recording.timer = setTimeout(() => {
        void this.flush(recording).catch(() => undefined)
      }, FLUSH_INTERVAL_MS)
    }
    return result
  }

  private flush(recording: Recording): Promise<void> {
    if (recording.timer) clearTimeout(recording.timer)
    recording.timer = undefined
    if (recording.flushQueued) return recording.queue
    recording.flushQueued = true
    return this.enqueue(recording, async () => {
      const batch = recording.pending.splice(0)
      try {
        await this.writeBatch(
          recording,
          batch.map((item) => item.record)
        )
        for (const item of batch) item.resolve()
      } catch (error) {
        for (const item of batch) item.reject(error)
        throw error
      } finally {
        recording.flushQueued = false
        if (recording.pending.length && !recording.timer) {
          recording.timer = setTimeout(() => {
            void this.flush(recording).catch(() => undefined)
          }, FLUSH_INTERVAL_MS)
        }
      }
    })
  }

  private async writeBatch(
    recording: Recording,
    records: Array<MatchLogRecord & { sequence: number }>
  ): Promise<void> {
    const text: string[] = []
    for (const snapshot of records) {
      text.push(recording.transcript.format(snapshot))
      recording.ai.accept(snapshot)
      if (
        snapshot.kind === 'command' &&
        snapshot.data.matchEnded === true &&
        recording.status === 'in-progress'
      ) {
        recording.status = 'completed'
      }
    }
    if (text.some(Boolean))
      await appendFile(join(recording.directory, 'match.txt'), text.join(''), 'utf8')
    if (records.length) await this.writeSummary(recording)
  }

  finish(id: string, status: MatchLogStatus): Promise<void> {
    const recording = this.get(id)
    void this.flush(recording).catch(() => undefined)
    return this.enqueue(recording, async () => {
      // Include records that arrived while an earlier flush was writing.
      const pending = recording.pending.splice(0)
      if (recording.timer) clearTimeout(recording.timer)
      recording.timer = undefined
      try {
        await this.writeBatch(
          recording,
          pending.map((item) => item.record)
        )
        pending.forEach((item) => item.resolve())
      } catch (error) {
        pending.forEach((item) => item.reject(error))
        throw error
      }
      if (recording.status === 'in-progress') {
        recording.status = status
        if (status === 'interrupted') recording.recordingIncomplete = true
        await appendFile(
          join(recording.directory, 'match.txt'),
          status === 'completed'
            ? '\nMatch completed.\n'
            : status === 'abandoned'
              ? '\nMatch abandoned before it ended.\n'
              : '\nMatch interrupted before it ended.\n',
          'utf8'
        )
      }
      await this.writeSummary(recording)
    })
  }

  private async writeSummary(recording: Recording): Promise<void> {
    if (recording.failure && !recording.failureReported) {
      await appendFile(
        join(recording.directory, 'match.txt'),
        '\nMatch recording is incomplete because logging failed.\n',
        'utf8'
      )
        .then(() => {
          recording.failureReported = true
        })
        .catch(() => undefined)
    }
    await atomicText(
      recording.directory,
      'ai-decisions.md',
      recordingHeader(recording.status, recording.recordingIncomplete) +
        recording.ai.render() +
        (recording.failure ? '\n' + recording.failure + '\n' : '')
    )
  }

  async interrupt(owner?: number): Promise<void> {
    await Promise.allSettled(
      [...this.recordings.values()]
        .filter((recording) => owner === undefined || recording.owner === owner)
        .map((recording) => this.finish(recording.id, 'interrupted'))
    )
  }
}
