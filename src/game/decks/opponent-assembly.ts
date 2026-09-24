import type { CardDefinition } from '../content/cards'
import type { DeterministicRng } from '../match/rng'
import { getCardCopyLimit, MAX_DECK_CARDS } from './deck'
import type { OpponentArchetype } from './opponent-archetype'
import type { OpponentTag } from './opponent-curated-assessment'
import { OPPONENT_CARD_RATINGS } from './opponent-card-ratings'
import { OpponentDeckDraft, type ResolvedOpponentFloor } from './opponent-deck-draft'
import {
  assessOpponentCoreCard,
  isOpponentPowerCard,
  type OpponentFillCard
} from './opponent-fill-pool'
import {
  opponentSupportGaps,
  opponentSupportSwapEvaluator,
  opponentSupportTags,
  type OpponentSupportGap
} from './opponent-support'

export interface OpponentConstructionStep {
  readonly layer: string
  readonly selected: string
  readonly reason: string
  readonly candidates: number
  readonly deckSize: number
}

export interface OpponentFixedCard {
  readonly card: CardDefinition
  readonly layer: string
  readonly reason: string
}

export interface OpponentAssemblyPools {
  /** Random fill: class-legal cards of quality 3 or better. */
  readonly fill: readonly OpponentFillCard[]
  /** On-theme candidates for a package floor, including its relaxed cards. */
  packageCandidates(floor: ResolvedOpponentFloor): readonly OpponentFillCard[]
}

export interface OpponentAssemblyInput {
  readonly archetype: OpponentArchetype
  readonly floors: readonly ResolvedOpponentFloor[]
  readonly fixed: readonly OpponentFixedCard[]
  readonly pools: OpponentAssemblyPools
  readonly rng: DeterministicRng
  readonly supportBonus: Readonly<Partial<Record<OpponentTag, number>>>
}

export interface OpponentAssemblyResult {
  readonly draft: OpponentDeckDraft
  readonly errors: readonly string[]
  readonly trace: readonly OpponentConstructionStep[]
  readonly floorReport: string
}

interface AssemblyContext extends OpponentAssemblyInput {
  readonly draft: OpponentDeckDraft
  readonly trace: OpponentConstructionStep[]
}

const MAX_SUPPORT_REPAIRS = 60

export function weightedPick<T>(
  values: readonly T[],
  weight: (value: T) => number,
  rng: DeterministicRng
): T {
  if (!values.length) throw new Error('No eligible opponent candidates.')
  const weights = values.map(weight)
  let roll = rng.next() * weights.reduce((a, b) => a + b, 0)
  for (let index = 0; index < values.length; index++) {
    roll -= weights[index]
    if (roll < 0) return values[index]
  }
  return values[values.length - 1]
}

/**
 * Builds one candidate list in fixed phases: core, packages, floors, flexible fill,
 * then support repair. Any phase error aborts the attempt so the caller can retry.
 */
export function assembleOpponentDeck(
  input: OpponentAssemblyInput
): OpponentAssemblyResult {
  const context: AssemblyContext = {
    ...input,
    draft: new OpponentDeckDraft(input.floors),
    trace: []
  }
  const error =
    placeFixed(context) ??
    fillPackages(context) ??
    fillFloors(context) ??
    fillFlexible(context) ??
    repairSupport(context) ??
    checkFloors(context)
  return {
    draft: context.draft,
    errors: error ? [error] : [],
    trace: context.trace,
    floorReport: input.floors
      .map(
        (floor) =>
          `${floor.tag}=${context.draft.count(floor.tag)} [${floor.min}..${floor.max}]`
      )
      .join('; ')
  }
}

/** Quality cubed, class affinity, archetype bias and second-copy preference. */
function weight(context: AssemblyContext, entry: OpponentFillCard): number {
  return (
    entry.quality ** 3 *
    (entry.card.cardClass !== 'Neutral' ? 2 : 1) *
    (context.archetype.bias.some((tag) => entry.tags.includes(tag)) ? 1.5 : 1) *
    (context.draft.copiesOf(entry.card) === 1 ? 1.5 : 1)
  )
}

function qualityReason(entry: OpponentFillCard): string {
  const source =
    OPPONENT_CARD_RATINGS[entry.card.id] === undefined
      ? 'automatically assessed'
      : 'explicitly rated'
  return `Quality ${entry.quality}/5 (${source})`
}

function record(
  context: AssemblyContext,
  card: CardDefinition,
  layer: string,
  reason: string,
  candidates: number
): void {
  context.draft.add(card)
  context.trace.push({
    layer,
    selected: card.id,
    reason,
    candidates,
    deckSize: context.draft.size
  })
}

function placeFixed(context: AssemblyContext): string | undefined {
  for (const entry of context.fixed) {
    // Hero and Quest cards are deliberate power cards, not pool candidates.
    if (
      !isOpponentPowerCard(entry.card) &&
      (!assessOpponentCoreCard(entry.card) ||
        context.draft.copiesOf(entry.card) >= getCardCopyLimit(entry.card))
    )
      return `${entry.card.id}: ineligible or copy-conflicting fixed card`
    record(context, entry.card, entry.layer, entry.reason, 1)
  }
  return undefined
}

/** Packages come first so the archetype's synergy is guaranteed before random fill. */
function fillPackages(context: AssemblyContext): string | undefined {
  const { draft } = context
  for (const floor of context.floors) {
    if (floor.packageMinQuality === undefined) continue
    while (draft.deficit(floor) > 0) {
      const candidates = context.pools
        .packageCandidates(floor)
        .filter((entry) => draft.accepts(entry.card))
      if (!candidates.length)
        return `Package unmet: ${floor.tag} (${draft.count(floor.tag)}/${floor.min})`
      const selected = weightedPick(
        candidates,
        (entry) => weight(context, entry),
        context.rng
      )
      record(
        context,
        selected.card,
        `package:${floor.tag}`,
        `Package ${floor.tag}: ${draft.count(floor.tag)}/${floor.min}; ${qualityReason(selected)}.`,
        candidates.length
      )
    }
  }
  return undefined
}

/** The neediest floor is served first; cards that also help other open floors are preferred. */
function fillFloors(context: AssemblyContext): string | undefined {
  const { draft } = context
  for (;;) {
    const unmet = draft.unmetFloors()
    if (!unmet.length) return undefined
    const target = unmet.reduce((best, floor) =>
      draft.deficit(floor) > draft.deficit(best) ? floor : best
    )
    const candidates = context.pools.fill.filter(
      (entry) => entry.tags.includes(target.tag) && draft.accepts(entry.card)
    )
    if (!candidates.length)
      return `Floor unmet: ${target.tag} (${draft.count(target.tag)}/${target.min})`
    const selected = weightedPick(
      candidates,
      (entry) =>
        weight(context, entry) *
        1.5 **
          unmet.filter((floor) => floor !== target && entry.tags.includes(floor.tag))
            .length,
      context.rng
    )
    record(
      context,
      selected.card,
      `fill:${target.tag}`,
      `Floor ${target.tag}: ${draft.count(target.tag)}/${target.min}; ${qualityReason(selected)}; weighted by quality cubed, class affinity, archetype bias, second-copy preference and other open floors.`,
      candidates.length
    )
  }
}

function fillFlexible(context: AssemblyContext): string | undefined {
  const { draft } = context
  while (draft.size < MAX_DECK_CARDS) {
    const candidates = context.pools.fill.filter((entry) => draft.accepts(entry.card))
    if (!candidates.length) return 'No compatible fill slots remain.'
    const selected = weightedPick(
      candidates,
      (entry) => weight(context, entry),
      context.rng
    )
    record(
      context,
      selected.card,
      'fill',
      `Flexible slot; ${qualityReason(selected)}; weighted by quality cubed, class affinity, archetype bias and second-copy preference.`,
      candidates.length
    )
  }
  return undefined
}

const totalMissing = (gaps: readonly OpponentSupportGap[]): number =>
  gaps.reduce((sum, gap) => sum + gap.min - gap.actual, 0)

/**
 * Repair the finished list so a payoff can be supported by cards picked after it.
 * Every replacement must reduce total missing support; the bound prevents loops.
 */
function repairSupport(context: AssemblyContext): string | undefined {
  const { draft } = context
  for (let repair = 0; repair < MAX_SUPPORT_REPAIRS; repair++) {
    const gaps = opponentSupportGaps(draft.cards, context.supportBonus)
    if (!gaps.length) return undefined
    const target = gaps.find((gap) => gap.index < context.fixed.length) ?? gaps[0]
    const replacements = supportReplacements(context, target, totalMissing(gaps))
    if (!replacements.length)
      return `Cannot support ${draft.cards[target.index].id}: ${target.tag} ${target.actual}/${target.min}.`
    const selected = weightedPick(
      replacements.map(({ entry }) => entry),
      (entry) => weight(context, entry),
      context.rng
    )
    const index = replacements.find(({ entry }) => entry === selected)!.index
    const removed = draft.removeAt(index)
    record(
      context,
      selected.card,
      'repair:support',
      `Replaced ${removed.id}; missing ${target.tag} support (${target.actual}/${target.min}). ${qualityReason(selected)}.`,
      replacements.length
    )
  }
  return opponentSupportGaps(draft.cards, context.supportBonus).length
    ? 'Card support repair limit reached.'
    : undefined
}

/** Fixed payoffs receive support. Unsupported non-fixed cards are replaced directly. */
function supportReplacements(
  context: AssemblyContext,
  target: OpponentSupportGap,
  missing: number
): { entry: OpponentFillCard; index: number }[] {
  const { draft } = context
  const fixedPayoff = target.index < context.fixed.length
  const indices = fixedPayoff
    ? draft.cards.map((_, index) => index).slice(context.fixed.length)
    : [target.index]
  const replacements: { entry: OpponentFillCard; index: number }[] = []
  const evaluateSwap = opponentSupportSwapEvaluator(draft.cards, context.supportBonus)
  for (const entry of context.pools.fill) {
    if (fixedPayoff && !opponentSupportTags(entry.card).includes(target.tag)) continue
    if (draft.copiesOf(entry.card) >= getCardCopyLimit(entry.card)) continue
    for (const index of indices) {
      const removed = draft.cards[index]
      if (
        removed.id === entry.card.id ||
        !draft.keepsFloorsAfterSwap(removed, entry.card)
      )
        continue
      const swap = evaluateSwap(index, entry.card)
      if (swap.swappedCardUnsupported || swap.missing >= missing) continue
      replacements.push({ entry, index })
      break
    }
  }
  return replacements
}

function checkFloors(context: AssemblyContext): string | undefined {
  const unmet = context.draft
    .unmetFloors()
    .map((floor) => `${floor.tag} (${context.draft.count(floor.tag)}/${floor.min})`)
  return unmet.length ? `Floor unmet: ${unmet.join(', ')}` : undefined
}
