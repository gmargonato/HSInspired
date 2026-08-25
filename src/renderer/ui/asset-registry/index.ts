import { Texture, type AssetsManifest } from 'pixi.js'
import tableImage from '@assets/images/ui/main-menu/table.png'
import boxImage from '@assets/images/ui/main-menu/box.png'
import leftLidImage from '@assets/images/ui/main-menu/left-lid.png'
import rightLidImage from '@assets/images/ui/main-menu/right-lid.png'
import centerPartImage from '@assets/images/ui/main-menu/center-part.png'
import centerPartMenuImage from '@assets/images/ui/main-menu/center-part-menu.png'
import buttonPlayImage from '@assets/images/ui/main-menu/menu-button-play.png'
import buttonCollectionImage from '@assets/images/ui/main-menu/menu-button-collection.png'
import deckSelectionImage from '@assets/images/ui/deck-selection/deck-selection.png'
import collectionBackgroundImage from '@assets/images/ui/collection/collection-background.png'
import collectionCoverImage from '@assets/images/ui/collection/collection-cover.png'
import collectionCoverLockImage from '@assets/images/ui/collection/collection-cover-lock.png'
import deckSelectionToCollectionButtonImage from '@assets/images/ui/deck-selection/deck-selection-to-collection-button.png'
import playButtonImage from '@assets/images/ui/deck-selection/play-button.png'
import uiBackButtonImage from '@assets/images/ui/common/ui-back-button.png'
import uiDoneButtonImage from '@assets/images/ui/common/ui-done-button.png'
import loadDeckButtonImage from '@assets/images/ui/collection/load-deck-button.png'
import newDeckButtonImage from '@assets/images/ui/deck-builder/new-deck-button.png'
import newDeckHeroSelectionImage from '@assets/images/ui/deck-builder/new-deck-hero-selection.png'
import selectClassButtonImage from '@assets/images/ui/deck-builder/select-class-button.png'
import uiCancelButtonImage from '@assets/images/ui/common/ui-cancel-button.png'
import verticalSliderImage from '@assets/images/ui/common/vertical-slider.png'
import menuSettingsBackgroundImage from '@assets/images/ui/settings/menu-settings-background.png'
import gameSettingsBackgroundImage from '@assets/images/ui/settings/game-settings-background.png'
import gameBoardImage from '@assets/images/match/BOARD.png'
import gameDeckImage from '@assets/images/match/deck.png'
import gameEndTurnImage from '@assets/images/match/button-end-my-turn.png'
import gameEnemyTurnImage from '@assets/images/match/button-enemy-turn.png'
import gameYourTurnImage from '@assets/images/match/flag-your-turn.png'
import cardBackImage from '@assets/images/cards/card-back.png'
import startOfGameVsImage from '@assets/images/match/start-of-game-vs.png'
import mulliganAnnouncementImage from '@assets/images/match/mulligan-announcement.png'
import mulliganReplaceCrossImage from '@assets/images/match/mulligan-replace-cross.png'
import mulliganReplacedLabelImage from '@assets/images/match/mulligan-replaced-label.png'
import confirmMulliganButtonImage from '@assets/images/match/confirm-mulligan-button.png'
import mulliganCoinAnnouncementImage from '@assets/images/match/mulligan-coin-announcement.png'
import manaCrystalImage from '@assets/images/cards/mana.png'
import heroPowerBackImage from '@assets/images/heroes/hero-power/hero-power-back.png'
import heroPowerManaImage from '@assets/images/heroes/hero-power/hero-power-mana.png'
import minionFrameImage from '@assets/images/board/minion-frame.png'
import minionFrameLegendaryImage from '@assets/images/board/minion-frame-legendary.png'
import minionTauntImage from '@assets/images/board/minion-taunt.png'
import minionDivineShieldImage from '@assets/images/board/minion-divine-shield.png'
import minionAttackImage from '@assets/images/board/minion-attack.png'
import minionHealthImage from '@assets/images/board/minion-health.png'
import minionWillDieImage from '@assets/images/board/character-will-die.png'
import weaponImage from '@assets/images/board/weapon.png'
import searchClearImage from '@assets/images/cards/silence.png'
import searchNoResultsImage from '@assets/images/ui/collection/search-no-results.png'
import expansionButtonToggleImage from '@assets/images/ui/collection/expansion-button-toggle.png'
import expansionTrayImage from '@assets/images/ui/collection/expansion-tray.png'
import expansionCollectionOnImage from '@assets/images/ui/collection/expansion-collection-on.png'
import expansionCollectionOffImage from '@assets/images/ui/collection/expansion-collection-off.png'
import deleteDeckContainerImage from '@assets/images/ui/deck-builder/delete-deck-container.png'
import actionButtonConfirmImage from '@assets/images/ui/deck-builder/action-button-confirm.png'
import actionButtonCancelImage from '@assets/images/ui/deck-builder/action-button-cancel.png'
import cardPreviewDetailContainerImage from '@assets/images/ui/card-preview/card-preview-detail-container.png'
import cardAddAuraImage from '@assets/images/effects/aura-01.png'
import arrowBodyImage from '@assets/images/match/arrow-body.png'
import arrowHeadImage from '@assets/images/match/arrow-head.png'
import druidNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-druid.png'
import druidDeckFrameImage from '@assets/images/heroes/frames/druid-deck-frame.png'
import hunterDeckFrameImage from '@assets/images/heroes/frames/hunter-deck-frame.png'
import hunterNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-hunter.png'
import mageDeckFrameImage from '@assets/images/heroes/frames/mage-deck-frame.png'
import mageNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-mage.png'
import paladinDeckFrameImage from '@assets/images/heroes/frames/paladin-deck-frame.png'
import paladinNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-paladin.png'
import priestDeckFrameImage from '@assets/images/heroes/frames/priest-deck-frame.png'
import priestNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-priest.png'
import rogueDeckFrameImage from '@assets/images/heroes/frames/rogue-deck-frame.png'
import rogueNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-rogue.png'
import shamanDeckFrameImage from '@assets/images/heroes/frames/shaman-deck-frame.png'
import shamanNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-shaman.png'
import warlockDeckFrameImage from '@assets/images/heroes/frames/warlock-deck-frame.png'
import warlockNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-warlock.png'
import warriorDeckFrameImage from '@assets/images/heroes/frames/warrior-deck-frame.png'
import warriorNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-warrior.png'
import { HERO_ASSET_SOURCES, type HeroAssetKey } from './hero-assets'
import { HERO_POWER_ASSET_SOURCES, type HeroPowerAssetKey } from './hero-power-assets'
import { CARD_ASSET_DEFINITIONS, type CardAssetDefinition } from './card-assets'
import { registerAssetBundle } from './asset-scope'

export { AssetScope } from './asset-scope'
export { CardAssetResolver } from './card-asset-resolver'
export * from './card-assets'
export type { HeroPowerAssetKey } from './hero-power-assets'

export { ASSET_BUNDLE_IDS } from './asset-bundle-ids'
export { asset, type AssetDefinition } from './asset-definition'
export type { StandaloneAssetSource, AtlasFrameAssetSource } from './asset-definition'
import { ASSET_BUNDLE_IDS } from './asset-bundle-ids'
import { asset, type AssetDefinition } from './asset-definition'

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
    'scene.deck-selection.play-button',
    ASSET_BUNDLE_IDS.deckSelection,
    'playButton',
    playButtonImage,
    199,
    199,
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
    'scene.menu-settings.background',
    ASSET_BUNDLE_IDS.menuSettings,
    'background',
    menuSettingsBackgroundImage,
    1920,
    1080,
    'menu-settings'
  ),
  asset(
    'scene.game-settings.background',
    ASSET_BUNDLE_IDS.gameSettings,
    'background',
    gameSettingsBackgroundImage,
    1920,
    1080,
    'game-settings'
  ),
  asset(
    'scene.game.table',
    ASSET_BUNDLE_IDS.game,
    'table',
    tableImage,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board',
    ASSET_BUNDLE_IDS.game,
    'board',
    gameBoardImage,
    1443,
    1046,
    'game-scene'
  ),
  asset(
    'scene.game.minion-frame',
    ASSET_BUNDLE_IDS.game,
    'minionFrame',
    minionFrameImage,
    119,
    161,
    'game-scene'
  ),
  asset(
    'scene.game.minion-frame-legendary',
    ASSET_BUNDLE_IDS.game,
    'minionFrameLegendary',
    minionFrameLegendaryImage,
    136,
    99,
    'game-scene'
  ),
  asset(
    'scene.game.minion-taunt',
    ASSET_BUNDLE_IDS.game,
    'minionTaunt',
    minionTauntImage,
    136,
    183,
    'game-scene'
  ),
  asset(
    'scene.game.minion-divine-shield',
    ASSET_BUNDLE_IDS.game,
    'minionDivineShield',
    minionDivineShieldImage,
    125,
    167,
    'game-scene'
  ),
  asset(
    'scene.game.minion-attack',
    ASSET_BUNDLE_IDS.game,
    'minionAttack',
    minionAttackImage,
    44,
    51,
    'game-scene'
  ),
  asset(
    'scene.game.minion-health',
    ASSET_BUNDLE_IDS.game,
    'minionHealth',
    minionHealthImage,
    38,
    54,
    'game-scene'
  ),
  asset(
    'scene.game.minion-will-die',
    ASSET_BUNDLE_IDS.game,
    'minionWillDie',
    minionWillDieImage,
    109,
    114,
    'game-scene'
  ),
  asset(
    'scene.game.weapon',
    ASSET_BUNDLE_IDS.game,
    'weapon',
    weaponImage,
    172,
    146,
    'game-scene'
  ),
  asset(
    'scene.game.minion-summon-rays',
    ASSET_BUNDLE_IDS.game,
    'minionSummonRays',
    cardAddAuraImage,
    500,
    500,
    'game-scene'
  ),
  asset(
    'scene.game.deck',
    ASSET_BUNDLE_IDS.game,
    'deck',
    gameDeckImage,
    83,
    181,
    'game-scene'
  ),
  asset(
    'scene.game.mana-crystal',
    ASSET_BUNDLE_IDS.game,
    'manaCrystal',
    manaCrystalImage,
    171,
    165,
    'game-scene'
  ),
  asset(
    'scene.game.end-turn',
    ASSET_BUNDLE_IDS.game,
    'endTurn',
    gameEndTurnImage,
    157,
    86,
    'game-scene'
  ),
  asset(
    'scene.game.enemy-turn',
    ASSET_BUNDLE_IDS.game,
    'enemyTurn',
    gameEnemyTurnImage,
    158,
    87,
    'game-scene'
  ),
  asset(
    'scene.game.your-turn',
    ASSET_BUNDLE_IDS.game,
    'yourTurn',
    gameYourTurnImage,
    856,
    345,
    'game-scene'
  ),
  asset(
    'scene.game.card-back',
    ASSET_BUNDLE_IDS.game,
    'cardBack',
    cardBackImage,
    620,
    900,
    'game-scene'
  ),
  asset(
    'scene.game.start-of-game-vs',
    ASSET_BUNDLE_IDS.game,
    'startOfGameVs',
    startOfGameVsImage,
    273,
    279,
    'game-scene'
  ),
  asset(
    'scene.game.mulligan-announcement',
    ASSET_BUNDLE_IDS.game,
    'mulliganAnnouncement',
    mulliganAnnouncementImage,
    721,
    223,
    'game-scene'
  ),
  asset(
    'scene.game.mulligan-replace-cross',
    ASSET_BUNDLE_IDS.game,
    'mulliganReplaceCross',
    mulliganReplaceCrossImage,
    210,
    265,
    'game-scene'
  ),
  asset(
    'scene.game.mulligan-replaced-label',
    ASSET_BUNDLE_IDS.game,
    'mulliganReplacedLabel',
    mulliganReplacedLabelImage,
    267,
    55,
    'game-scene'
  ),
  asset(
    'scene.game.confirm-mulligan-button',
    ASSET_BUNDLE_IDS.game,
    'confirmMulliganButton',
    confirmMulliganButtonImage,
    235,
    127,
    'game-scene'
  ),
  asset(
    'scene.game.mulligan-coin-announcement',
    ASSET_BUNDLE_IDS.game,
    'mulliganCoinAnnouncement',
    mulliganCoinAnnouncementImage,
    646,
    455,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-back',
    ASSET_BUNDLE_IDS.game,
    'heroPowerBack',
    heroPowerBackImage,
    148,
    162,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-mana',
    ASSET_BUNDLE_IDS.game,
    'heroPowerMana',
    heroPowerManaImage,
    57,
    55,
    'game-scene'
  ),
  ...Object.entries(HERO_POWER_ASSET_SOURCES).map(([key, source]) =>
    asset(
      `scene.game.hero-power.${key}`,
      ASSET_BUNDLE_IDS.game,
      key,
      source,
      150,
      150,
      'game-scene'
    )
  ),
  asset(
    'scene.game.arrow-body',
    ASSET_BUNDLE_IDS.game,
    'arrowBody',
    arrowBodyImage,
    77,
    124,
    'game-scene'
  ),
  asset(
    'scene.game.arrow-head',
    ASSET_BUNDLE_IDS.game,
    'arrowHead',
    arrowHeadImage,
    119,
    57,
    'game-scene'
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
    171,
    165,
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
    'scene.collection.expansion-toggle',
    ASSET_BUNDLE_IDS.collection,
    'expansionToggle',
    expansionButtonToggleImage,
    102,
    77,
    'collection'
  ),
  asset(
    'scene.collection.expansion-tray',
    ASSET_BUNDLE_IDS.collection,
    'expansionTray',
    expansionTrayImage,
    369,
    657,
    'collection'
  ),
  asset(
    'scene.collection.expansion-collection-on',
    ASSET_BUNDLE_IDS.collection,
    'expansionCollectionOn',
    expansionCollectionOnImage,
    312,
    116,
    'collection'
  ),
  asset(
    'scene.collection.expansion-collection-off',
    ASSET_BUNDLE_IDS.collection,
    'expansionCollectionOff',
    expansionCollectionOffImage,
    312,
    116,
    'collection'
  ),
  asset(
    'scene.collection.delete-deck-container',
    ASSET_BUNDLE_IDS.collection,
    'deleteDeckContainer',
    deleteDeckContainerImage,
    1920,
    1080,
    'collection'
  ),
  asset(
    'scene.collection.delete-deck-confirm',
    ASSET_BUNDLE_IDS.collection,
    'deleteDeckConfirm',
    actionButtonConfirmImage,
    232,
    67,
    'collection'
  ),
  asset(
    'scene.collection.delete-deck-cancel',
    ASSET_BUNDLE_IDS.collection,
    'deleteDeckCancel',
    actionButtonCancelImage,
    230,
    65,
    'collection'
  ),
  asset(
    'scene.collection.card-add-aura',
    ASSET_BUNDLE_IDS.collection,
    'cardAddAura',
    cardAddAuraImage,
    500,
    500,
    'collection'
  ),
  asset(
    'scene.card-preview.detail-container',
    ASSET_BUNDLE_IDS.cardPreview,
    'detailContainer',
    cardPreviewDetailContainerImage,
    447,
    678,
    'card-preview'
  ),
  asset(
    'deck-presentation.druid-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'druidDeckFrame',
    druidDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.hunter-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'hunterDeckFrame',
    hunterDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.mage-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'mageDeckFrame',
    mageDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.paladin-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'paladinDeckFrame',
    paladinDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.priest-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'priestDeckFrame',
    priestDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.rogue-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'rogueDeckFrame',
    rogueDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.shaman-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'shamanDeckFrame',
    shamanDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.warlock-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'warlockDeckFrame',
    warlockDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.warrior-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'warriorDeckFrame',
    warriorDeckFrameImage,
    239,
    107,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.druid-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'druidNewDeckFrame',
    druidNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.hunter-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'hunterNewDeckFrame',
    hunterNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.mage-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'mageNewDeckFrame',
    mageNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.paladin-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'paladinNewDeckFrame',
    paladinNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.priest-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'priestNewDeckFrame',
    priestNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.rogue-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'rogueNewDeckFrame',
    rogueNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.shaman-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'shamanNewDeckFrame',
    shamanNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.warlock-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'warlockNewDeckFrame',
    warlockNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.warrior-new-deck-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'warriorNewDeckFrame',
    warriorNewDeckFrameImage,
    246,
    266,
    'deck-presentation'
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
      ASSET_BUNDLE_IDS.deckPresentation,
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
  playButton: Texture
}

export interface DeckPresentationAssets extends Record<HeroAssetKey, Texture> {
  druidDeckFrame: Texture
  hunterDeckFrame: Texture
  mageDeckFrame: Texture
  paladinDeckFrame: Texture
  priestDeckFrame: Texture
  rogueDeckFrame: Texture
  shamanDeckFrame: Texture
  warlockDeckFrame: Texture
  warriorDeckFrame: Texture
  druidNewDeckFrame: Texture
  hunterNewDeckFrame: Texture
  mageNewDeckFrame: Texture
  paladinNewDeckFrame: Texture
  priestNewDeckFrame: Texture
  rogueNewDeckFrame: Texture
  shamanNewDeckFrame: Texture
  warlockNewDeckFrame: Texture
  warriorNewDeckFrame: Texture
}

export interface GameAssets extends Record<HeroPowerAssetKey, Texture> {
  table: Texture
  board: Texture
  minionFrame: Texture
  minionFrameLegendary: Texture
  minionTaunt: Texture
  minionDivineShield: Texture
  minionAttack: Texture
  minionHealth: Texture
  minionWillDie: Texture
  weapon: Texture
  minionSummonRays: Texture
  deck: Texture
  manaCrystal: Texture
  endTurn: Texture
  enemyTurn: Texture
  yourTurn: Texture
  cardBack: Texture
  startOfGameVs: Texture
  mulliganAnnouncement: Texture
  mulliganReplaceCross: Texture
  mulliganReplacedLabel: Texture
  confirmMulliganButton: Texture
  mulliganCoinAnnouncement: Texture
  heroPowerBack: Texture
  heroPowerMana: Texture
  arrowBody: Texture
  arrowHead: Texture
}

export interface SettingsBackgroundAssets {
  background: Texture
}

export interface SharedUIAssets {
  backButton: Texture
  doneButton: Texture
}

export interface CollectionAssets {
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
  expansionToggle: Texture
  expansionTray: Texture
  expansionCollectionOn: Texture
  expansionCollectionOff: Texture
  deleteDeckContainer: Texture
  deleteDeckConfirm: Texture
  deleteDeckCancel: Texture
  cardAddAura: Texture
}

export interface CardPreviewAssets {
  detailContainer: Texture
}
