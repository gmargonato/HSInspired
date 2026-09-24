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
} from '../../shared/ipc/ai'
import type { MatchLogRecord, MatchLogStatus } from '../../shared/ipc/match-logs'
import { MatchLogTranscript } from './match-log-transcript'
import { AiLog } from './ai-log'
import { AiConversationTranscript } from './ai-conversation-transcript'

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
  readonly startedAt: number
  queue: Promise<void>
  sequence: number
  summary: Record<string, JsonValue>
  transcript: MatchLogTranscript
  conversation: AiConversationTranscript
  ai: AiLog
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

async function atomicJson(
  directory: string,
  name: string,
  value: unknown
): Promise<void> {
  const target = join(directory, name)
  try {
    await writeFile(target + '.tmp', serializeMatchLog(value, true) + '\n', 'utf8')
    await rename(target + '.tmp', target)
  } finally {
    await unlink(target + '.tmp').catch(() => undefined)
  }
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
          await appendFile(
            join(directory, 'match.txt'),
            '\nThe previous session ended unexpectedly.\nThe match recording may be missing its final events.\n'
          )
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
    const summary: JsonObject = {
      schemaVersion: AI_LOG_SCHEMA_VERSION,
      matchId: id,
      startedAt: timestamp,
      status: 'in-progress',
      recordingIncomplete: false,
      participants: [],
      decisions: [],
      ...(metadata.generatedOpponent
        ? { generatedOpponent: metadata.generatedOpponent }
        : {}),
      model: null,
      ...(typeof (metadata.aiConfig as JsonObject | undefined)?.modelId === 'string'
        ? { configuredModel: (metadata.aiConfig as JsonObject).modelId }
        : {})
    }
    const generated = metadata.generatedOpponent as JsonObject | undefined
    const construction = Array.isArray(generated?.construction)
      ? generated.construction
      : []
    const constructionText = construction
      .map((value) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
        const step = value as JsonObject
        return `[${String(step.layer)}] ${String(step.selected)} — ${String(step.reason)} (candidates: ${String(step.candidates)}; deck: ${String(step.deckSize)}/30)\n`
      })
      .join('')
    await writeFile(
      join(directory, 'match.txt'),
      'Match started.\n' +
        (constructionText
          ? '\nOpponent deck construction (generator rules and selections)\n' +
            constructionText +
            '\n'
          : ''),
      { flag: 'wx' }
    )
    await writeFile(
      join(directory, 'ai-conversation.txt'),
      'AI conversation\nA readable view of the context supplied, questions, choices, and results.\nAI explanations are returned explanations, not private internal reasoning.\nPrevious conversation is retained within the configured limits and is not repeated here.\n\n',
      { flag: 'wx' }
    )
    await atomicJson(directory, 'ai.json', summary)
    this.recordings.set(id, {
      id,
      owner,
      directory,
      startedAt,
      queue: Promise.resolve(),
      sequence: 0,
      summary,
      transcript: new MatchLogTranscript(),
      ai: new AiLog(summary),
      conversation: new AiConversationTranscript(),
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
      recording.summary.loggingFailures =
        Number(recording.summary.loggingFailures ?? 0) + 1
      recording.summary.recordingIncomplete = true
      await atomicJson(recording.directory, 'ai.json', recording.summary).catch(
        () => undefined
      )
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
      recording.summary.recordingIncomplete = true
      recording.summary.loggingFailures =
        Number(recording.summary.loggingFailures ?? 0) + 1
      return Promise.reject(new Error(recording.failure))
    }
    // IPC owns its structured-cloned value; provider records are immutable call-time values.
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
    const conversation: string[] = []
    const text: string[] = []
    for (const snapshot of records) {
      text.push(recording.transcript.format(snapshot))
      conversation.push(recording.conversation.format(snapshot))
      if (snapshot.kind === 'match-start') {
        recording.summary.participants = snapshot.data.participants ?? []
        continue
      }
      const data = { ...snapshot.data }
      if (
        snapshot.kind === 'command' &&
        data.matchEnded === true &&
        recording.summary.status === 'in-progress'
      ) {
        recording.summary.status = 'completed'
        recording.summary.winnerId = data.winnerId ?? null
        recording.summary.endedAt = snapshot.timestamp
        recording.summary.durationMs =
          Date.parse(snapshot.timestamp) - recording.startedAt
      }
      const participants = recording.summary.participants as JsonObject[]
      const remote = participants.find(
        (player) => player.label === 'Remote Player'
      )?.participantId
      const execution = snapshot.kind === 'command' && data.actor === remote
      if (execution || snapshot.stream === 'decisions') recording.ai.accept(snapshot)
    }
    const decisions = records.filter((entry) => entry.stream === 'decisions')
    if (decisions.length && process.env['HSINSPIRED_AI_FULL_TRANSCRIPT'] === '1')
      await appendFile(
        join(recording.directory, 'decisions.jsonl'),
        decisions.map((entry) => serializeMatchLog(entry)).join('\n') + '\n',
        'utf8'
      )
    if (conversation.some(Boolean))
      await appendFile(
        join(recording.directory, 'ai-conversation.txt'),
        conversation.join(''),
        'utf8'
      )
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
      if (recording.summary.status === 'in-progress') {
        recording.summary.status = status
        recording.summary.endedAt = new Date().toISOString()
        recording.summary.durationMs = Date.now() - recording.startedAt
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
    recording.summary.updatedAt = new Date().toISOString()
    await atomicJson(recording.directory, 'ai.json', recording.summary)
  }

  async interrupt(owner?: number): Promise<void> {
    await Promise.allSettled(
      [...this.recordings.values()]
        .filter((recording) => owner === undefined || recording.owner === owner)
        .map((recording) => this.finish(recording.id, 'interrupted'))
    )
  }
}
