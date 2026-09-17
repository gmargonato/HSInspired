import type { CardType } from '../content/cards'

/** Supported visual forms. Keep purchases and rendering on the same capability rule. */
export const PREMIUM_FORMAT_SUPPORT: Readonly<Record<CardType | 'HeroPower', boolean>> =
  {
    Minion: true,
    Spell: true,
    Weapon: true,
    Hero: true,
    HeroPower: false
  }

export function supportsPremiumFormat(type: CardType | 'HeroPower'): boolean {
  return PREMIUM_FORMAT_SUPPORT[type]
}
