import type { DeckClass } from '../../../shared/decks'

export type DeckFrameAssetKey =
  | 'druidDeckFrame'
  | 'hunterDeckFrame'
  | 'mageDeckFrame'
  | 'paladinDeckFrame'
  | 'priestDeckFrame'
  | 'rogueDeckFrame'
  | 'shamanDeckFrame'
  | 'warlockDeckFrame'
  | 'warriorDeckFrame'

export const DECK_FRAME_ASSET_KEYS: Record<DeckClass, DeckFrameAssetKey> = {
  Warlock: 'warlockDeckFrame',
  Hunter: 'hunterDeckFrame',
  Rogue: 'rogueDeckFrame',
  Warrior: 'warriorDeckFrame',
  Druid: 'druidDeckFrame',
  Paladin: 'paladinDeckFrame',
  Priest: 'priestDeckFrame',
  Mage: 'mageDeckFrame',
  Shaman: 'shamanDeckFrame'
}
