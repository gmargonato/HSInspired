import type { DeckClass } from '../../../game/content/cards'

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

export type NewDeckFrameAssetKey =
  | 'druidNewDeckFrame'
  | 'hunterNewDeckFrame'
  | 'mageNewDeckFrame'
  | 'paladinNewDeckFrame'
  | 'priestNewDeckFrame'
  | 'rogueNewDeckFrame'
  | 'shamanNewDeckFrame'
  | 'warlockNewDeckFrame'
  | 'warriorNewDeckFrame'

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

export const NEW_DECK_FRAME_ASSET_KEYS: Record<DeckClass, NewDeckFrameAssetKey> = {
  Warlock: 'warlockNewDeckFrame',
  Hunter: 'hunterNewDeckFrame',
  Rogue: 'rogueNewDeckFrame',
  Warrior: 'warriorNewDeckFrame',
  Druid: 'druidNewDeckFrame',
  Paladin: 'paladinNewDeckFrame',
  Priest: 'priestNewDeckFrame',
  Mage: 'mageNewDeckFrame',
  Shaman: 'shamanNewDeckFrame'
}
