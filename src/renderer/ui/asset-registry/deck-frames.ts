import type { DeckClass } from '../../../game/content/cards'

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
