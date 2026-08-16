import { Texture } from 'pixi.js'
import tableImage from '@assets/images/TABLE.png'
import boxImage from '@assets/images/BOX.png'
import leftLidImage from '@assets/images/LEFT_LID.png'
import rightLidImage from '@assets/images/RIGHT_LID.png'
import centerPartImage from '@assets/images/CENTER_PART.png'
import centerPartMenuImage from '@assets/images/CENTER_PART_MENU.png'
import buttonPlayImage from '@assets/images/MENU_BUTTON_PLAY.png'
import buttonCollectionImage from '@assets/images/MENU_BUTTON_COLLECTION.png'
import deckSelectionImage from '@assets/images/DECK_SELECTION.png'
import { registerAssetBundle } from './assetScope'

export { AssetScope } from './assetScope'

export const ASSET_BUNDLE_IDS = {
  mainMenu: 'main-menu',
  deckSelection: 'deck-selection'
} as const

export interface MainMenuAssets {
  table: Texture
  box: Texture
  leftLid: Texture
  rightLid: Texture
  centerPart: Texture
  centerPartMenu: Texture
  buttonPlay: Texture
  buttonCollection: Texture
}

export interface DeckSelectionAssets {
  panel: Texture
}

registerAssetBundle(ASSET_BUNDLE_IDS.mainMenu, {
  table: tableImage,
  box: boxImage,
  leftLid: leftLidImage,
  rightLid: rightLidImage,
  centerPart: centerPartImage,
  centerPartMenu: centerPartMenuImage,
  buttonPlay: buttonPlayImage,
  buttonCollection: buttonCollectionImage
})

registerAssetBundle(ASSET_BUNDLE_IDS.deckSelection, {
  panel: deckSelectionImage
})
