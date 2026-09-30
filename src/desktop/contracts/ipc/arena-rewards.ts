import {
  CARD_CATALOG,
  asCardId,
  type ArenaRewardReceipt,
  type ArenaReward
} from '../../../game-rules'
import { premiumUpgradeCost } from '../../../game-rules/progression/arcane-dust'
import { parseDustAmount } from './progression'

export function parseArenaRunId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value))
    throw new Error('Invalid Arena run ID.')
  return value
}

export function parseArenaRewardReceipt(value: unknown): ArenaRewardReceipt {
  if (!value || typeof value !== 'object') throw new Error('Invalid Arena rewards.')
  const receipt = value as Record<string, unknown>
  const runId = parseArenaRunId(receipt.runId)
  const wins = receipt.wins
  if (
    typeof wins !== 'number' ||
    !Number.isInteger(wins) ||
    wins < 0 ||
    wins > 12 ||
    !Array.isArray(receipt.prizes) ||
    receipt.prizes.length < 1 ||
    receipt.prizes.length > 5
  )
    throw new Error('Invalid Arena rewards.')
  const seen = new Set<string>()
  const prizes: ArenaReward[] = receipt.prizes.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid Arena prize.')
    const prize = item as Record<string, unknown>
    if (prize.kind === 'dust') {
      const amount = parseDustAmount(prize.amount)
      if (!amount) throw new Error('Empty Arena dust prize.')
      return { kind: 'dust', amount }
    }
    if (
      prize.kind !== 'premium' ||
      typeof prize.cardId !== 'string' ||
      seen.has(prize.cardId)
    )
      throw new Error('Invalid Arena premium prize.')
    const card = CARD_CATALOG.require(prize.cardId)
    if (premiumUpgradeCost(card) === null)
      throw new Error('Unsupported Arena premium prize.')
    seen.add(prize.cardId)
    return {
      kind: 'premium',
      cardId: asCardId(prize.cardId),
      refundValue: parseDustAmount(prize.refundValue)
    }
  })
  return { runId, wins, prizes }
}
