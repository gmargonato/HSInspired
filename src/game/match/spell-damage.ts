import type { CardDefinition } from '../content/cards'
import { SPELL_DAMAGE_TEXT_NUMBERS } from '../content/cards/spell-damage-text'
import type { OpeningPlayerState } from './opening-match-types'

type SpellDamagePlayer = Pick<OpeningPlayerState, 'hero' | 'board'>

export function spellDamageBonus(player: SpellDamagePlayer): number {
  return (
    player.board.reduce((sum, minion) => sum + (minion.spellDamage ?? 0), 0) +
    (player.hero.spellDamage ?? 0)
  )
}

export function spellDamageMultiplier(player: SpellDamagePlayer): number {
  return [player.hero, ...player.board].reduce(
    (value, source) => value * Math.max(0, source.spellDamageMultiplier ?? 1),
    1
  )
}

/** Shared pre-target scaling: armor, shields and target defenses do not affect card text. */
export function scaleSpellDamage(
  amount: number,
  bonus: number,
  multiplier: number
): number {
  const base = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0
  const scaled = Math.max(0, base + bonus) * multiplier
  return Number.isFinite(scaled) ? Math.max(0, Math.floor(scaled)) : 0
}

export function spellDamageRulesText(
  card: CardDefinition,
  player: SpellDamagePlayer
): string {
  if (card.type !== 'Spell') return card.rulesText
  const bonus = spellDamageBonus(player)
  const multiplier = spellDamageMultiplier(player)
  if (bonus === 0 && multiplier === 1) return card.rulesText
  if (card.id === 'classic_shield_slam') {
    const amount = scaleSpellDamage(player.hero.armor, bonus, multiplier)
    return card.rulesText.replace(
      '1 damage to a minion for each Armor you have',
      `*${amount}* damage to a minion`
    )
  }
  const bindings = SPELL_DAMAGE_TEXT_NUMBERS[card.id]
  if (!bindings) return card.rulesText
  const bonusFactor =
    card.id === 'the_grand_tournament_arcane_blast'
      ? 2
      : card.id === 'goblins_vs_gnomes_burrowing_mine'
        ? 0
        : 1
  let index = 0
  return card.rulesText.replace(/\d+/g, (printed) => {
    if (!bindings.includes(index++)) return printed
    const amount = scaleSpellDamage(Number(printed), bonus * bonusFactor, multiplier)
    return amount === Number(printed) ? printed : `*${amount}*`
  })
}
