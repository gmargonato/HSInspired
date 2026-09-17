export interface ProgressionSnapshot {
  readonly dust: number
  /** The paid price is also the guaranteed refund. */
  readonly premiumPurchases: Readonly<Record<string, number>>
}

export interface DustRewardRequest {
  readonly matchId: string
  readonly mode: 'constructed' | 'arena' | 'tavern-brawl'
  readonly result: 'win' | 'defeat' | 'draw'
  readonly reason:
    'hero-health-depleted' | 'simultaneous-hero-lethal' | 'dev-forced' | 'concede'
}

export interface DustRewardReceipt {
  readonly snapshot: ProgressionSnapshot
  /** Original reward, including on an idempotent retry. */
  readonly earned: number
}

export interface ProgressionApi {
  /** Exposed only in development; the main process independently checks dev mode. */
  devSetDust?(amount: number): Promise<ProgressionSnapshot>
  get(): Promise<ProgressionSnapshot>
  reward(request: DustRewardRequest): Promise<DustRewardReceipt>
  upgrade(cardId: string): Promise<ProgressionSnapshot>
  refund(cardId: string): Promise<ProgressionSnapshot>
}

export const PROGRESSION_IPC_CHANNELS = {
  get: 'progression:get',
  reward: 'progression:reward',
  upgrade: 'progression:upgrade',
  refund: 'progression:refund',
  devSetDust: 'progression:dev-set-dust'
} as const

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseDustAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid Arcane Dust amount')
  return value
}

export function parseProgressionCardId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,199}$/.test(value))
    throw new Error('Invalid progression card id')
  return value
}

export function parseProgressionSnapshot(value: unknown): ProgressionSnapshot {
  if (!record(value) || !record(value.premiumPurchases))
    throw new Error('Invalid progression save')
  const premiumPurchases: Record<string, number> = {}
  for (const [id, price] of Object.entries(value.premiumPurchases)) {
    premiumPurchases[parseProgressionCardId(id)] = parseDustAmount(price)
  }
  return { dust: parseDustAmount(value.dust), premiumPurchases }
}

export function parseDustRewardRequest(value: unknown): DustRewardRequest {
  if (
    !record(value) ||
    typeof value.matchId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(value.matchId) ||
    typeof value.mode !== 'string' ||
    !['constructed', 'arena', 'tavern-brawl'].includes(value.mode) ||
    typeof value.result !== 'string' ||
    !['win', 'defeat', 'draw'].includes(value.result) ||
    typeof value.reason !== 'string' ||
    ![
      'hero-health-depleted',
      'simultaneous-hero-lethal',
      'dev-forced',
      'concede'
    ].includes(value.reason)
  )
    throw new Error('Invalid dust reward request')
  return {
    matchId: value.matchId,
    mode: value.mode as DustRewardRequest['mode'],
    result: value.result as DustRewardRequest['result'],
    reason: value.reason as DustRewardRequest['reason']
  }
}

export function parseDustRewardReceipt(value: unknown): DustRewardReceipt {
  if (!record(value)) throw new Error('Invalid dust reward receipt')
  return {
    snapshot: parseProgressionSnapshot(value.snapshot),
    earned: parseDustAmount(value.earned)
  }
}
