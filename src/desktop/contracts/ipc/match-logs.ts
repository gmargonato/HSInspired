import type { JsonObject } from './ai'

export const MATCH_LOG_CHANNELS = {
  start: 'match-logs:start',
  append: 'match-logs:append',
  finish: 'match-logs:finish'
} as const

export type MatchLogStream = 'events' | 'decisions'
export type MatchLogStatus = 'completed' | 'abandoned' | 'interrupted'

export interface MatchLogStartData extends JsonObject {
  readonly participants: Array<{
    participantId: string
    label: 'Local Player' | 'Remote Player'
    heroId: string
  }>
  readonly firstPlayerId: string
  readonly hands: Array<{ participantId: string; cards: string[] }>
}

export interface MatchLogCommandData extends JsonObject {
  readonly accepted: boolean
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly beforeTurnNumber: number
  readonly afterTurnNumber: number
  readonly events: JsonObject[]
  readonly matchEnded: boolean
  readonly turnEnded: boolean
}

export interface MatchLogRecord {
  readonly stream: MatchLogStream
  readonly kind: string
  readonly timestamp: string
  readonly revision?: number
  readonly turnNumber?: number
  readonly decisionId?: string
  readonly data: JsonObject
}

export interface MatchLogsApi {
  start(metadata: JsonObject): Promise<string>
  append(matchId: string, record: MatchLogRecord): Promise<void>
  finish(matchId: string, status: MatchLogStatus): Promise<void>
}

export function parseMatchLogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) {
    throw new Error('Invalid match log ID.')
  }
  return value
}

export function parseMatchLogStatus(value: unknown): MatchLogStatus {
  if (value !== 'completed' && value !== 'abandoned' && value !== 'interrupted') {
    throw new Error('Invalid match log status.')
  }
  return value
}

/** Only JSON crosses the bridge. Credentials are never part of the log contract. */
export function parseMatchLogObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Match log data must be an object.')
  }
  // IPC already structured-clones the payload. Do not serialize/copy it again here.
  return value as JsonObject
}

export function parseMatchLogRecord(value: unknown): MatchLogRecord {
  const record = parseMatchLogObject(value)
  if (!['events', 'decisions'].includes(String(record.stream))) {
    throw new Error('Invalid match log stream.')
  }
  if (typeof record.kind !== 'string' || !record.kind || record.kind.length > 160) {
    throw new Error('Invalid match log kind.')
  }
  if (
    typeof record.timestamp !== 'string' ||
    !Number.isFinite(Date.parse(record.timestamp))
  ) {
    throw new Error('Invalid match log timestamp.')
  }
  for (const key of ['revision', 'turnNumber'] as const) {
    if (
      record[key] !== undefined &&
      (!Number.isSafeInteger(record[key]) || Number(record[key]) < 0)
    ) {
      throw new Error(`Invalid match log ${key}.`)
    }
  }
  if (
    record.decisionId !== undefined &&
    (typeof record.decisionId !== 'string' || record.decisionId.length > 200)
  ) {
    throw new Error('Invalid match log decision ID.')
  }
  return {
    stream: record.stream as MatchLogStream,
    kind: record.kind,
    timestamp: record.timestamp,
    ...(record.revision === undefined ? {} : { revision: record.revision as number }),
    ...(record.turnNumber === undefined
      ? {}
      : { turnNumber: record.turnNumber as number }),
    ...(record.decisionId === undefined
      ? {}
      : { decisionId: record.decisionId as string }),
    data: parseMatchLogObject(record.data)
  }
}
