import { Texture, type AssetsManifest } from 'pixi.js'
import tableImage from '@assets/images/ui/table.png'
import boxImage from '@assets/images/ui/box.png'
import leftLidImage from '@assets/images/ui/left-lid.png'
import rightLidImage from '@assets/images/ui/right-lid.png'
import centerPartImage from '@assets/images/ui/center-part.png'
import centerPartMenuImage from '@assets/images/ui/center-part-menu.png'
import buttonPlayImage from '@assets/images/ui/menu-button-play.png'
import buttonCollectionImage from '@assets/images/ui/menu-button-collection.png'
import deckSelectionImage from '@assets/images/ui/deck-selection.png'
import collectionBackgroundImage from '@assets/images/ui/collection-background.png'
import collectionCoverImage from '@assets/images/ui/collection-cover.png'
import collectionCoverLockImage from '@assets/images/ui/collection-cover-lock.png'
import deckSelectionToCollectionButtonImage from '@assets/images/ui/deck-selection-to-collection-button.png'
import uiBackButtonImage from '@assets/images/ui/ui-back-button.png'
import uiDoneButtonImage from '@assets/images/ui/ui-done-button.png'
import loadDeckButtonImage from '@assets/images/ui/load-deck-button.png'
import newDeckButtonImage from '@assets/images/ui/new-deck-button.png'
import newDeckHeroSelectionImage from '@assets/images/ui/new-deck-hero-selection.png'
import selectClassButtonImage from '@assets/images/ui/select-class-button.png'
import uiCancelButtonImage from '@assets/images/ui/ui-cancel-button.png'
import verticalSliderImage from '@assets/images/ui/vertical-slider.png'
import manaCrystalImage from '@assets/images/cards/mana.png'
import searchClearImage from '@assets/images/cards/silence.png'
import searchNoResultsImage from '@assets/images/ui/search-no-results.png'
import druidDeckFrameImage from '@assets/images/heroes/frames/druid-deck-frame.png'
import hunterDeckFrameImage from '@assets/images/heroes/frames/hunter-deck-frame.png'
import mageDeckFrameImage from '@assets/images/heroes/frames/mage-deck-frame.png'
import paladinDeckFrameImage from '@assets/images/heroes/frames/paladin-deck-frame.png'
import priestDeckFrameImage from '@assets/images/heroes/frames/priest-deck-frame.png'
import rogueDeckFrameImage from '@assets/images/heroes/frames/rogue-deck-frame.png'
import shamanDeckFrameImage from '@assets/images/heroes/frames/shaman-deck-frame.png'
import warlockDeckFrameImage from '@assets/images/heroes/frames/warlock-deck-frame.png'
import warriorDeckFrameImage from '@assets/images/heroes/frames/warrior-deck-frame.png'
import { HERO_ASSET_SOURCES, type HeroAssetKey } from './hero-assets'
import { CARD_ASSET_DEFINITIONS, type CardAssetDefinition } from './card-assets'
import { registerAssetBundle } from './asset-scope'

export { AssetScope } from './asset-scope'
export { CardAssetResolver } from './card-asset-resolver'
export * from './card-assets'

export const ASSET_BUNDLE_IDS = {
  mainMenu: 'main-menu',
  deckSelection: 'deck-selection',
  collection: 'collection',
  sharedUI: 'shared-ui',
  cardRendering: 'card-rendering'
} as const

export type StandaloneAssetSource = {
  readonly kind: 'standalone'
  readonly src: string
}

export type AtlasFrameAssetSource = {
  readonly kind: 'atlas-frame'
  readonly src: string
  readonly frame: string
}

export interface AssetDefinition {
  readonly key: string
  readonly alias: string
  readonly bundle: string
  readonly source: StandaloneAssetSource | AtlasFrameAssetSource
  readonly authoredWidth: number
  readonly authoredHeight: number
  readonly owner: string
}

function asset(
  key: string,
  bundle: string,
  alias: string,
  source: string,
  authoredWidth: number,
  authoredHeight: number,
  owner: string
): AssetDefinition {
  return {
    key,
    alias,
    bundle,
    source: { kind: 'standalone', src: source },
    authoredWidth,
    authoredHeight,
    owner
  }
}

const bespokeAssetDefinitions: readonly AssetDefinition[] = [
  asset(
    'scene.main-menu.table',
    ASSET_BUNDLE_IDS.mainMenu,
    'table',
    tableImage,
    1920,
    1080,
    'main-menu'
  ),
  asset(
    'scene.main-menu.box',
    ASSET_BUNDLE_IDS.mainMenu,
    'box',
    boxImage,
    1345,
    988,
    'main-menu'
  ),
  asset(
    'scene.main-menu.left-lid',
    ASSET_BUNDLE_IDS.mainMenu,
    'leftLid',
    leftLidImage,
    566,
    738,
    'main-menu'
  ),
  asset(
    'scene.main-menu.right-lid',
    ASSET_BUNDLE_IDS.mainMenu,
    'rightLid',
    rightLidImage,
    548,
    739,
    'main-menu'
  ),
  asset(
    'scene.main-menu.center',
    ASSET_BUNDLE_IDS.mainMenu,
    'centerPart',
    centerPartImage,
    516,
    516,
    'main-menu'
  ),
  asset(
    'scene.main-menu.center-menu',
    ASSET_BUNDLE_IDS.mainMenu,
    'centerPartMenu',
    centerPartMenuImage,
    510,
    518,
    'main-menu'
  ),
  asset(
    'scene.main-menu.play-button',
    ASSET_BUNDLE_IDS.mainMenu,
    'buttonPlay',
    buttonPlayImage,
    355,
    65,
    'main-menu'
  ),
  asset(
    'scene.main-menu.collection-button',
    ASSET_BUNDLE_IDS.mainMenu,
    'buttonCollection',
    buttonCollectionImage,
    426,
    73,
    'main-menu'
  ),
  asset(
    'scene.deck-selection.background',
    ASSET_BUNDLE_IDS.deckSelection,
    'panel',
    deckSelectionImage,
    1920,
    1080,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.collection-button',
    ASSET_BUNDLE_IDS.deckSelection,
    'toCollectionButton',
    deckSelectionToCollectionButtonImage,
    293,
    47,
    'deck-selection'
  ),
  asset(
    'scene.collection.background',
    ASSET_BUNDLE_IDS.collection,
    'background',
    collectionBackgroundImage,
    1920,
    1080,
    'collection'
  ),
  asset(
    'scene.collection.cover',
    ASSET_BUNDLE_IDS.collection,
    'cover',
    collectionCoverImage,
    1157,
    1080,
    'collection'
  ),
  asset(
    'scene.collection.cover-lock',
    ASSET_BUNDLE_IDS.collection,
    'coverLock',
    collectionCoverLockImage,
    254,
    244,
    'collection'
  ),
  asset(
    'scene.collection.load-deck-button',
    ASSET_BUNDLE_IDS.collection,
    'loadDeckButton',
    loadDeckButtonImage,
    283,
    151,
    'collection'
  ),
  asset(
    'scene.collection.new-deck-button',
    ASSET_BUNDLE_IDS.collection,
    'newDeckButton',
    newDeckButtonImage,
    283,
    151,
    'collection'
  ),
  asset(
    'scene.collection.hero-selection',
    ASSET_BUNDLE_IDS.collection,
    'newDeckHeroSelection',
    newDeckHeroSelectionImage,
    1920,
    1080,
    'collection'
  ),
  asset(
    'scene.collection.select-class-button',
    ASSET_BUNDLE_IDS.collection,
    'selectClassButton',
    selectClassButtonImage,
    199,
    199,
    'collection'
  ),
  asset(
    'scene.collection.cancel-button',
    ASSET_BUNDLE_IDS.collection,
    'cancelButton',
    uiCancelButtonImage,
    107,
    47,
    'collection'
  ),
  asset(
    'scene.collection.vertical-slider',
    ASSET_BUNDLE_IDS.collection,
    'verticalSlider',
    verticalSliderImage,
    34,
    94,
    'collection'
  ),
  asset(
    'scene.collection.mana-crystal',
    ASSET_BUNDLE_IDS.collection,
    'manaCrystal',
    manaCrystalImage,
    153,
    181,
    'collection'
  ),
  asset(
    'scene.collection.search-clear',
    ASSET_BUNDLE_IDS.collection,
    'searchClear',
    searchClearImage,
    327,
    265,
    'collection'
  ),
  asset(
    'scene.collection.search-no-results',
    ASSET_BUNDLE_IDS.collection,
    'searchNoResults',
    searchNoResultsImage,
    328,
    226,
    'collection'
  ),
  asset(
    'scene.collection.druid-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'druidDeckFrame',
    druidDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.hunter-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'hunterDeckFrame',
    hunterDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.mage-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'mageDeckFrame',
    mageDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.paladin-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'paladinDeckFrame',
    paladinDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.priest-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'priestDeckFrame',
    priestDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.rogue-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'rogueDeckFrame',
    rogueDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.shaman-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'shamanDeckFrame',
    shamanDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.warlock-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'warlockDeckFrame',
    warlockDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'scene.collection.warrior-deck-frame',
    ASSET_BUNDLE_IDS.collection,
    'warriorDeckFrame',
    warriorDeckFrameImage,
    239,
    107,
    'collection'
  ),
  asset(
    'ui.back-button',
    ASSET_BUNDLE_IDS.sharedUI,
    'backButton',
    uiBackButtonImage,
    107,
    47,
    'shared-ui'
  ),
  asset(
    'ui.done-button',
    ASSET_BUNDLE_IDS.sharedUI,
    'doneButton',
    uiDoneButtonImage,
    107,
    47,
    'shared-ui'
  ),
  ...Object.entries(HERO_ASSET_SOURCES).map(([key, source]) =>
    asset(
      `hero.${key}`,
      ASSET_BUNDLE_IDS.collection,
      key,
      source,
      345,
      433,
      'hero-catalog'
    )
  )
]

const cardDefinitions: readonly AssetDefinition[] = CARD_ASSET_DEFINITIONS.map(
  (definition: CardAssetDefinition) =>
    asset(
      definition.key,
      ASSET_BUNDLE_IDS.cardRendering,
      definition.key,
      definition.source,
      definition.authoredWidth,
      definition.authoredHeight,
      'card-renderer'
    )
)

export const ASSET_DEFINITIONS: readonly AssetDefinition[] = [
  ...bespokeAssetDefinitions,
  ...cardDefinitions
]

const definitionByKey = new Map<string, AssetDefinition>()
for (const definition of ASSET_DEFINITIONS) {
  if (definitionByKey.has(definition.key))
    throw new Error(`Duplicate semantic asset key: ${definition.key}`)
  definitionByKey.set(definition.key, definition)
}

export function resolveAssetDefinition(key: string): AssetDefinition {
  const definition = definitionByKey.get(key)
  if (!definition) throw new Error(`Unknown semantic asset key: ${key}`)
  return definition
}

const manifestBundles = [
  ...new Set(ASSET_DEFINITIONS.map((definition) => definition.bundle))
].map((bundleName) => ({
  name: bundleName,
  assets: ASSET_DEFINITIONS.filter(
    (definition) => definition.bundle === bundleName
  ).map((definition) => ({ alias: definition.alias, src: definition.source.src }))
}))

export const ASSETS_MANIFEST: AssetsManifest = { bundles: manifestBundles }

for (const bundle of manifestBundles) {
  const entries = Object.fromEntries(
    bundle.assets.map((entry) => [entry.alias, entry.src])
  ) as Record<string, string>
  registerAssetBundle(bundle.name, entries)
}

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
  doneButton: Texture
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
  manaCrystal: Texture
  searchClear: Texture
  searchNoResults: Texture
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
