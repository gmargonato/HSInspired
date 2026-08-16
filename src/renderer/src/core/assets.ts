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
import collectionBackgroundImage from '@assets/images/COLLECTION_BACKGROUND.png'
import collectionCoverImage from '@assets/images/COLLECTION_COVER.png'
import collectionCoverLockImage from '@assets/images/COLLECTION_COVER_LOCK.png'
import deckSelectionToCollectionButtonImage from '@assets/images/DECK_SELECTION_TO_COLLECTION_BUTTON.png'
import uiBackButtonImage from '@assets/images/UI_BACK_BUTTON.png'
import { registerAssetBundle } from './assetScope'

export { AssetScope } from './assetScope'

export const ASSET_BUNDLE_IDS = {
  mainMenu: 'main-menu',
  deckSelection: 'deck-selection',
  collection: 'collection'
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
  toCollectionButton: Texture
  backButton: Texture
}

export interface CollectionAssets {
  background: Texture
  cover: Texture
  coverLock: Texture
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
  panel: deckSelectionImage,
  toCollectionButton: deckSelectionToCollectionButtonImage,
  backButton: uiBackButtonImage
})

registerAssetBundle(ASSET_BUNDLE_IDS.collection, {
  background: collectionBackgroundImage,
  cover: collectionCoverImage,
  coverLock: collectionCoverLockImage
})
