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
import loadDeckButtonImage from '@assets/images/LOAD_DECK_BUTTON.png'
import newDeckButtonImage from '@assets/images/NEW_DECK_BUTTON.png'
import newDeckHeroSelectionImage from '@assets/images/NEW_DECK_HERO_SELECTION.png'
import selectClassButtonImage from '@assets/images/SELECT_CLASS_BUTTON.png'
import uiCancelButtonImage from '@assets/images/UI_CANCEL_BUTTON.png'
import verticalSliderImage from '@assets/images/VERTICAL_SLIDER.png'
import druidDeckFrameImage from '@assets/images/portraits/DRUID_DECK_FRAME.png'
import hunterDeckFrameImage from '@assets/images/portraits/HUNTER_DECK_FRAME.png'
import mageDeckFrameImage from '@assets/images/portraits/MAGE_DECK_FRAME.png'
import paladinDeckFrameImage from '@assets/images/portraits/PALADIN_DECK_FRAME.png'
import priestDeckFrameImage from '@assets/images/portraits/PRIEST_DECK_FRAME.png'
import rogueDeckFrameImage from '@assets/images/portraits/ROGUE_DECK_FRAME.png'
import shamanDeckFrameImage from '@assets/images/portraits/SHAMAN_DECK_FRAME.png'
import warlockDeckFrameImage from '@assets/images/portraits/WARLOCK_DECK_FRAME.png'
import warriorDeckFrameImage from '@assets/images/portraits/WARRIOR_DECK_FRAME.png'
import { registerAssetBundle } from './assetScope'
import { HERO_ASSET_SOURCES, type HeroAssetKey } from './heroes'

export { AssetScope } from './assetScope'

export const ASSET_BUNDLE_IDS = {
  mainMenu: 'main-menu',
  deckSelection: 'deck-selection',
  collection: 'collection',
  sharedUI: 'shared-ui'
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
}

export interface SharedUIAssets {
  backButton: Texture
}

export interface CollectionAssets extends Record<HeroAssetKey, Texture> {
  background: Texture
  cover: Texture
  coverLock: Texture
  loadDeckButton: Texture
  newDeckButton: Texture
  newDeckHeroSelection: Texture
  selectClassButton: Texture
  cancelButton: Texture
  verticalSlider: Texture
  druidDeckFrame: Texture
  hunterDeckFrame: Texture
  mageDeckFrame: Texture
  paladinDeckFrame: Texture
  priestDeckFrame: Texture
  rogueDeckFrame: Texture
  shamanDeckFrame: Texture
  warlockDeckFrame: Texture
  warriorDeckFrame: Texture
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
  toCollectionButton: deckSelectionToCollectionButtonImage
})

registerAssetBundle(ASSET_BUNDLE_IDS.collection, {
  background: collectionBackgroundImage,
  cover: collectionCoverImage,
  coverLock: collectionCoverLockImage,
  loadDeckButton: loadDeckButtonImage,
  newDeckButton: newDeckButtonImage,
  newDeckHeroSelection: newDeckHeroSelectionImage,
  selectClassButton: selectClassButtonImage,
  cancelButton: uiCancelButtonImage,
  verticalSlider: verticalSliderImage,
  druidDeckFrame: druidDeckFrameImage,
  hunterDeckFrame: hunterDeckFrameImage,
  mageDeckFrame: mageDeckFrameImage,
  paladinDeckFrame: paladinDeckFrameImage,
  priestDeckFrame: priestDeckFrameImage,
  rogueDeckFrame: rogueDeckFrameImage,
  shamanDeckFrame: shamanDeckFrameImage,
  warlockDeckFrame: warlockDeckFrameImage,
  warriorDeckFrame: warriorDeckFrameImage,
  ...HERO_ASSET_SOURCES
})

registerAssetBundle(ASSET_BUNDLE_IDS.sharedUI, {
  backButton: uiBackButtonImage
})
