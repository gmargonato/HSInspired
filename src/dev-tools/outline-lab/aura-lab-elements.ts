import type { OutlinePresetName } from '../../visual-components/effects/outline-tuning'

export const AURA_CATEGORIES = {
  Cards: ['card', 'bonus-card'],
  Buttons: ['deck-frame', 'play-button', 'end-turn', 'expansion-toggle'],
  Board: ['minion', 'hero', 'hero-power', 'weapon', 'secret', 'quest']
} as const satisfies Record<string, readonly OutlinePresetName[]>

export type AuraCategory = keyof typeof AURA_CATEGORIES
export type AuraBackground = 'context' | 'dark' | 'light'

export const AURA_ELEMENT_LABELS: Record<OutlinePresetName, string> = {
  card: 'Card',
  'bonus-card': 'Bonus Card',
  'deck-frame': 'Deck Frame',
  'play-button': 'Play Button',
  'end-turn': 'End Turn Button',
  'expansion-toggle': 'Collection Expansion Toggle',
  minion: 'Minion',
  hero: 'Hero Portrait',
  'hero-power': 'Hero Power',
  weapon: 'Weapon',
  secret: 'Secret',
  quest: 'Quest'
}

export function auraCategory(preset: OutlinePresetName): AuraCategory {
  if (preset === 'card' || preset === 'bonus-card') return 'Cards'
  if ((AURA_CATEGORIES.Buttons as readonly string[]).includes(preset)) return 'Buttons'
  return 'Board'
}
