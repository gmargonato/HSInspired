import loadScreenOverlayImage from '@assets/images/ui/deck-selection/load-screen-overlay.png'
import ghostSpotlightImage from '@assets/images/effects/spotlight-triangle.png'
import ghostDissolveImage from '@assets/images/effects/noise-03.png'
import { Texture, type AssetsManifest } from 'pixi.js'
import burnNoiseImage from '@assets/images/effects/noise-01.jpg'
import spellPlayAuraImage from '@assets/images/cards/play-aura-spell.png'
import minionPlayAuraImage from '@assets/images/cards/play-aura-minion.png'
import playSpotlight1Image from '@assets/images/effects/spotlight-01.png'
import playSpotlight2Image from '@assets/images/effects/spotlight-02.png'
import playSpotlight3Image from '@assets/images/effects/spotlight-03.png'
import playSpotlight4Image from '@assets/images/effects/spotlight-04.png'
import playSpotlight5Image from '@assets/images/effects/spotlight-05.png'
import playSpotlight6Image from '@assets/images/effects/spotlight-06.png'
import playSpotlight7Image from '@assets/images/effects/spotlight-07.png'
import playSpotlight8Image from '@assets/images/effects/spotlight-08.png'
import tableImage from '@assets/images/ui/main-menu/table.png'
import boxImage from '@assets/images/ui/main-menu/box.png'
import leftLidImage from '@assets/images/ui/main-menu/left-lid.png'
import rightLidImage from '@assets/images/ui/main-menu/right-lid.png'
import centerPartImage from '@assets/images/ui/main-menu/center-part.png'
import centerPartMenuImage from '@assets/images/ui/main-menu/center-part-menu.png'
import buttonPlayImage from '@assets/images/ui/main-menu/menu-button-play.png'
import buttonCollectionImage from '@assets/images/ui/main-menu/menu-button-collection.png'
import buttonArenaImage from '@assets/images/ui/main-menu/menu-button-arena.png'
import buttonTavernImage from '@assets/images/ui/main-menu/menu-button-tavern.png'
import arenaBackgroundImage from '@assets/images/ui/arena/arena-background.png'
import arenaRewardBoxImage from '@assets/images/ui/arena/reward-box.png'
import arenaConfirmRewardImage from '@assets/images/ui/arena/arena-confirm-reward.png'
import arenaBackgroundOngoingImage from '@assets/images/ui/arena/arena-background-ongoing.png'
import arenaKey0Image from '@assets/images/ui/arena/key-0.png'
import arenaKey1Image from '@assets/images/ui/arena/key-1.png'
import arenaKey2Image from '@assets/images/ui/arena/key-2.png'
import arenaKey3Image from '@assets/images/ui/arena/key-3.png'
import arenaKey4Image from '@assets/images/ui/arena/key-4.png'
import arenaKey5Image from '@assets/images/ui/arena/key-5.png'
import arenaKey6Image from '@assets/images/ui/arena/key-6.png'
import arenaKey7Image from '@assets/images/ui/arena/key-7.png'
import arenaKey8Image from '@assets/images/ui/arena/key-8.png'
import arenaKey9Image from '@assets/images/ui/arena/key-9.png'
import arenaKey10Image from '@assets/images/ui/arena/key-10.png'
import arenaKey11Image from '@assets/images/ui/arena/key-11.png'
import arenaKey12Image from '@assets/images/ui/arena/key-12.png'
import arenaDefeatXImage from '@assets/images/ui/arena/arena-defeat-x.png'
import arenaPlayButtonImage from '@assets/images/ui/arena/arena-play-button.png'
import arenaRetireButtonImage from '@assets/images/ui/arena/arena-retire-button.png'
import arenaRetireContainerImage from '@assets/images/ui/arena/retire-arena-container.png'
import arenaConfirmImage from '@assets/images/ui/arena/action-button-confirm.png'
import arenaCancelImage from '@assets/images/ui/arena/action-button-cancel.png'
import tavernBrawlBackgroundImage from '@assets/images/ui/tavern-brawl/tavern-background.png'
import tavernBrawlPlayButtonImage from '@assets/images/ui/tavern-brawl/brawl-play-buttom.png'
import deckSelectionImage from '@assets/images/ui/deck-selection/deck-selection.png'
import deckSelectionPaginationNextImage from '@assets/images/ui/deck-selection/pagination-button-next.png'
import rankMedal1Image from '@assets/images/ui/deck-selection/ranks/1.png'
import rankMedal2Image from '@assets/images/ui/deck-selection/ranks/2.png'
import rankMedal3Image from '@assets/images/ui/deck-selection/ranks/3.png'
import rankMedal4Image from '@assets/images/ui/deck-selection/ranks/4.png'
import rankMedal5Image from '@assets/images/ui/deck-selection/ranks/5.png'
import rankMedal6Image from '@assets/images/ui/deck-selection/ranks/6.png'
import rankMedal7Image from '@assets/images/ui/deck-selection/ranks/7.png'
import rankMedal8Image from '@assets/images/ui/deck-selection/ranks/8.png'
import rankMedal9Image from '@assets/images/ui/deck-selection/ranks/9.png'
import rankMedal10Image from '@assets/images/ui/deck-selection/ranks/10.png'
import rankMedal11Image from '@assets/images/ui/deck-selection/ranks/11.png'
import rankMedal12Image from '@assets/images/ui/deck-selection/ranks/12.png'
import rankMedal13Image from '@assets/images/ui/deck-selection/ranks/13.png'
import rankMedal14Image from '@assets/images/ui/deck-selection/ranks/14.png'
import rankMedal15Image from '@assets/images/ui/deck-selection/ranks/15.png'
import rankMedal16Image from '@assets/images/ui/deck-selection/ranks/16.png'
import rankMedal17Image from '@assets/images/ui/deck-selection/ranks/17.png'
import rankMedal18Image from '@assets/images/ui/deck-selection/ranks/18.png'
import rankMedal19Image from '@assets/images/ui/deck-selection/ranks/19.png'
import rankMedal20Image from '@assets/images/ui/deck-selection/ranks/20.png'
import rankMedal21Image from '@assets/images/ui/deck-selection/ranks/21.png'
import rankMedal22Image from '@assets/images/ui/deck-selection/ranks/22.png'
import rankMedal23Image from '@assets/images/ui/deck-selection/ranks/23.png'
import rankMedal24Image from '@assets/images/ui/deck-selection/ranks/24.png'
import rankMedal25Image from '@assets/images/ui/deck-selection/ranks/25.png'
import rankLegendImage from '@assets/images/ui/deck-selection/ranks/LEGEND.png'
import collectionBackgroundImage from '@assets/images/ui/collection/collection-background.png'
import collectionCoverImage from '@assets/images/ui/collection/collection-cover.png'
import collectionCoverLockImage from '@assets/images/ui/collection/collection-cover-lock.png'
import playButtonImage from '@assets/images/ui/deck-selection/play-button.png'
import uiBackButtonImage from '@assets/images/ui/common/ui-back-button.png'
import uiDoneButtonImage from '@assets/images/ui/common/ui-done-button.png'
import genericDialogImage from '@assets/images/ui/common/generic-dialog.png'
import loadDeckButtonImage from '@assets/images/ui/collection/load-deck-button.png'
import newDeckButtonImage from '@assets/images/ui/deck-builder/new-deck-button.png'
import newDeckHeroSelectionImage from '@assets/images/ui/deck-builder/new-deck-hero-selection.png'
import selectClassButtonImage from '@assets/images/ui/deck-builder/select-class-button.png'
import uiCancelButtonImage from '@assets/images/ui/common/ui-cancel-button.png'
import verticalSliderImage from '@assets/images/ui/common/vertical-slider.png'
import menuSettingsBackgroundImage from '@assets/images/ui/settings/menu-settings-background.png'
import gameSettingsBackgroundImage from '@assets/images/ui/settings/game-settings-background.png'
import settingsDropDownListImage from '@assets/images/ui/settings/settings-drop-down-list.png'
import settingsDropDownButtonImage from '@assets/images/ui/settings/settings-drop-down-button.png'
import settingsBaseFrameLargeImage from '@assets/images/ui/settings/settings-base-frame-large.png'
import settingsConcedeImage from '@assets/images/ui/settings/settings-concede.png'
import settingsRestartImage from '@assets/images/ui/settings/settings-restart.png'
import settingsQuitImage from '@assets/images/ui/settings/settings-quit.png'
import gameBoardBaseImage from '@assets/images/match/BOARD.png'
import gameBoard1Image from '@assets/images/match/BOARD-1.png'
import gameBoard2Image from '@assets/images/match/BOARD-2.png'
import gameBoard3Image from '@assets/images/match/BOARD-3.png'
import gameBoard4Image from '@assets/images/match/BOARD-4.png'
import gameBoard5Image from '@assets/images/match/BOARD-5.png'
import gameBoard6Image from '@assets/images/match/BOARD-6.png'
import gameBoard7Image from '@assets/images/match/BOARD-7.png'
import gameBoard8Image from '@assets/images/match/BOARD-8.png'
import gameBoard9Image from '@assets/images/match/BOARD-9.png'
import gameDeckImage from '@assets/images/match/deck.png'
import gameDeckSlicedImage from '@assets/images/match/deck-sliced.png'
import gameDeckInfoImage from '@assets/images/match/tray-number-of-cards-hand-deck.png'
import gameFatigueDeckImage from '@assets/images/match/fatigue-deck.png'
import gameEndTurnImage from '@assets/images/match/button-end-my-turn.png'
import gameEnemyTurnImage from '@assets/images/match/button-enemy-turn.png'
import gameYourTurnImage from '@assets/images/match/flag-your-turn.png'
import fatigueImage from '@assets/images/match/fatigue.png'
import damageIndicatorImage from '@assets/images/match/damage-indicator.png'
import healIndicatorImage from '@assets/images/match/heal-indicator.png'
import secretImage from '@assets/images/match/secret.png'
import questImage from '@assets/images/match/quest.png'
import questArrowImage from '@assets/images/match/quest-arrow.png'
import secretRevealedScreenImage from '@assets/images/match/secret-revealed-screen.png'
import cardBackImage from '@assets/images/cards/card-back.png'
import startOfGameVsImage from '@assets/images/match/start-of-game-vs.png'
import mulliganAnnouncementImage from '@assets/images/match/mulligan-announcement.png'
import mulliganReplaceCrossImage from '@assets/images/match/mulligan-replace-cross.png'
import mulliganReplacedLabelImage from '@assets/images/match/mulligan-replaced-label.png'
import confirmMulliganButtonImage from '@assets/images/match/confirm-mulligan-button.png'
import mulliganOpponentStillChoosingImage from '@assets/images/match/mulligan-opponent-still-choosing.png'
import toggleViewButtonImage from '@assets/images/match/toggle-view-button.png'
import mulliganCoinAnnouncementImage from '@assets/images/match/mulligan-coin-announcement.png'
import historyLocalImage from '@assets/images/match/history-local.png'
import historyRemoteImage from '@assets/images/match/history-remote.png'
import historyLocalAttackImage from '@assets/images/match/history-local-attack.png'
import historyLocalTriggerImage from '@assets/images/match/history-local-trigger.png'
import historyRemoteAttackImage from '@assets/images/match/history-remote-attack.png'
import historyRemoteTriggerImage from '@assets/images/match/history-remote-trigger.png'
import historyArrowImage from '@assets/images/match/history-arrow.png'
import historyBurnCardImage from '@assets/images/match/burn.png'
import historyBurnThumbImage from '@assets/images/match/history-burn-thumb.png'
import historyFatigueCardImage from '@assets/images/match/history-fatigue-card.png'
import historyFatigueThumbImage from '@assets/images/match/history-fatigue-thumb.png'
import manaCrystalImage from '@assets/images/cards/MANA.png'
import manaOverloadImage from '@assets/images/match/mana-overload.png'
import manaAvailableImage from '@assets/images/match/mana-available.png'
import manaSpentImage from '@assets/images/match/mana-spent.png'
import manaHighlightedImage from '@assets/images/match/mana-highlighted.png'
import historySecretCardImage from '@assets/images/match/history-secret-card.png'
import historySecretThumbImage from '@assets/images/match/history-secret-thumb.png'
import summonTotemImage from '@assets/images/match/summon-totem.png'
import tankUpHammerImage from '@assets/images/match/tank-up.png'
import effectCircle1Image from '@assets/images/effects/circle-01.png'
import heroPowerBackImage from '@assets/images/heroes/hero-power/hero-power-back.png'
import premiumHeroPowerBackImage from '@assets/images/heroes/hero-power/premium-hero-power-back.png'
import heroPowerFrontImage from '@assets/images/heroes/hero-power/hero-power-front.png'
import premiumHeroPowerFrontImage from '@assets/images/heroes/hero-power/premium-hero-power-front.png'
import heroPowerManaImage from '@assets/images/heroes/hero-power/hero-power-mana.png'
import discoverHistoryHeroPowerImage from '@assets/images/match/discover-history-hero-power.png'
import minionFrameImage from '@assets/images/board/minion-frame.png'
import premiumMinionFrameImage from '@assets/images/board/premium-minion-frame.png'
import minionFrameLegendaryImage from '@assets/images/board/minion-frame-legendary.png'
import premiumMinionFrameLegendaryImage from '@assets/images/board/premium-minion-frame-legendary.png'
import minionTauntImage from '@assets/images/board/minion-taunt.png'
import premiumMinionTauntImage from '@assets/images/board/premium-minion-taunt.png'
import minionBattlecryImage from '@assets/images/board/minion-battlecry.png'
import minionEnrageImage from '@assets/images/board/minion-enrage.png'
import minionDivineShieldImage from '@assets/images/board/minion-divine-shield.png'
import heroFrozenImage from '@assets/images/board/hero-frozen.png'
import heroImmuneImage from '@assets/images/board/hero-immune.png'
import minionFrozenImage from '@assets/images/board/minion-frozen.png'
import minionImmuneImage from '@assets/images/board/minion-immune.png'
import minionElusiveImage from '@assets/images/board/minion-elusive.png'
import minionSpellDamageImage from '@assets/images/board/minion-spell-damage.png'
import minionLifestealImage from '@assets/images/board/minion-lifesteal.png'
import minionAuraImage from '@assets/images/board/minion-aura.png'
import minionWindfuryImage from '@assets/images/board/minion-windfury.png'
import minionStealthImage from '@assets/images/board/minion-stealth.png'
import minionTriggerImage from '@assets/images/board/minion-trigger.png'
import minionInspireImage from '@assets/images/board/minion-inspire.png'
import minionDeathrattleImage from '@assets/images/board/minion-deathrattle.png'
import minionPoisonousImage from '@assets/images/board/minion-poisonous.png'
import minionAttackImage from '@assets/images/board/minion-attack.png'
import minionHealthImage from '@assets/images/board/minion-health.png'
import heroArmorImage from '@assets/images/cards/armor.png'
import minionWillDieImage from '@assets/images/board/character-will-die.png'
import weaponImage from '@assets/images/board/weapon.png'
import premiumWeaponImage from '@assets/images/board/premium-weapon.png'
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
import heroPowerAura2Image from '@assets/images/effects/aura-02.png'
import heroPowerAura3Image from '@assets/images/effects/aura-03.png'
import heroPowerAura4Image from '@assets/images/effects/aura-04.png'
import arrowBodyImage from '@assets/images/match/arrow-body.png'
import arrowHeadImage from '@assets/images/match/arrow-head.png'
import arrowCircleImage from '@assets/images/match/arrow-circle.png'
import winScreenImage from '@assets/images/match/win-screen.png'
import arcaneDustImage from '@assets/images/ui/common/arcane-dust.png'
import upgradeWindowImage from '@assets/images/ui/collection/upgrade-window-base.png'
import upgradeButtonImage from '@assets/images/ui/collection/upgrade-button.png'
import disenchantButtonImage from '@assets/images/ui/collection/disenchant-button.png'
import defeatScreenImage from '@assets/images/match/defeat-screen.png'
import anduinDeckPortraitImage from '@assets/images/heroes/original-art-portrait/anduin.png'
import garroshDeckPortraitImage from '@assets/images/heroes/original-art-portrait/garrosh.png'
import guldanDeckPortraitImage from '@assets/images/heroes/original-art-portrait/guldan.png'
import jainaDeckPortraitImage from '@assets/images/heroes/original-art-portrait/jaina.png'
import malfurionDeckPortraitImage from '@assets/images/heroes/original-art-portrait/malfurion.png'
import rexxarDeckPortraitImage from '@assets/images/heroes/original-art-portrait/rexxar.png'
import thrallDeckPortraitImage from '@assets/images/heroes/original-art-portrait/thrall.png'
import utherDeckPortraitImage from '@assets/images/heroes/original-art-portrait/uther.png'
import valeeraDeckPortraitImage from '@assets/images/heroes/original-art-portrait/valeera.png'
import druidNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-druid.png'
import hunterNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-hunter.png'
import mageNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-mage.png'
import paladinNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-paladin.png'
import priestNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-priest.png'
import rogueNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-rogue.png'
import shamanNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-shaman.png'
import warlockNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-warlock.png'
import warriorNewDeckFrameImage from '@assets/images/heroes/frames/new-deck-frame-warrior.png'
import { HERO_ASSET_SOURCES, type HeroAssetKey } from './hero-assets'
import { HERO_POWER_ASSET_SOURCES, type HeroPowerAssetKey } from './hero-power-assets'
import { CARD_ASSET_DEFINITIONS, type CardAssetDefinition } from './card-assets'
import { registerAssetBundle } from './asset-scope'

export { AssetScope } from './asset-scope'
export { CardAssetResolver } from './card-asset-resolver'
export * from './card-assets'
export type { HeroPowerAssetKey } from './hero-power-assets'

export { ASSET_BUNDLE_IDS, GAME_BOARD_BUNDLE_IDS } from './asset-bundle-ids'
export { asset, type AssetDefinition } from './asset-definition'
export type { StandaloneAssetSource, AtlasFrameAssetSource } from './asset-definition'
import { ASSET_BUNDLE_IDS, GAME_BOARD_BUNDLE_IDS } from './asset-bundle-ids'
import { asset, type AssetDefinition } from './asset-definition'

const bespokeAssetDefinitions: readonly AssetDefinition[] = [
  asset(
    'scene.main-menu.dust-round',
    ASSET_BUNDLE_IDS.mainMenu,
    'dustRound',
    playSpotlight1Image,
    256,
    256,
    'main-menu'
  ),
  asset(
    'scene.main-menu.dust-triangle',
    ASSET_BUNDLE_IDS.mainMenu,
    'dustTriangle',
    ghostSpotlightImage,
    256,
    256,
    'main-menu'
  ),
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
    'scene.main-menu.arena-button',
    ASSET_BUNDLE_IDS.mainMenu,
    'buttonArena',
    buttonArenaImage,
    428,
    73,
    'main-menu'
  ),
  asset(
    'scene.main-menu.tavern-button',
    ASSET_BUNDLE_IDS.mainMenu,
    'buttonTavern',
    buttonTavernImage,
    365,
    72,
    'main-menu'
  ),
  asset(
    'scene.tavern-brawl.background',
    ASSET_BUNDLE_IDS.tavernBrawl,
    'background',
    tavernBrawlBackgroundImage,
    1920,
    1080,
    'tavern-brawl'
  ),
  asset(
    'scene.arena.background',
    ASSET_BUNDLE_IDS.arena,
    'background',
    arenaBackgroundImage,
    1920,
    1080,
    'arena'
  ),
  asset(
    'scene.arena.reward-box',
    ASSET_BUNDLE_IDS.arena,
    'rewardBox',
    arenaRewardBoxImage,
    1254,
    1254,
    'arena'
  ),
  asset(
    'scene.arena.confirm-reward',
    ASSET_BUNDLE_IDS.arena,
    'confirmReward',
    arenaConfirmRewardImage,
    235,
    127,
    'arena'
  ),
  asset(
    'scene.arena.reward-dust',
    ASSET_BUNDLE_IDS.arena,
    'rewardDust',
    arcaneDustImage,
    180,
    243,
    'arena'
  ),
  asset(
    'scene.arena.background-ongoing',
    ASSET_BUNDLE_IDS.arena,
    'backgroundOngoing',
    arenaBackgroundOngoingImage,
    1920,
    1080,
    'arena'
  ),
  asset(
    'scene.arena.key-0',
    ASSET_BUNDLE_IDS.arena,
    'key0',
    arenaKey0Image,
    505,
    195,
    'arena'
  ),
  asset(
    'scene.arena.key-1',
    ASSET_BUNDLE_IDS.arena,
    'key1',
    arenaKey1Image,
    510,
    193,
    'arena'
  ),
  asset(
    'scene.arena.key-2',
    ASSET_BUNDLE_IDS.arena,
    'key2',
    arenaKey2Image,
    541,
    205,
    'arena'
  ),
  asset(
    'scene.arena.key-3',
    ASSET_BUNDLE_IDS.arena,
    'key3',
    arenaKey3Image,
    543,
    195,
    'arena'
  ),
  asset(
    'scene.arena.key-4',
    ASSET_BUNDLE_IDS.arena,
    'key4',
    arenaKey4Image,
    560,
    225,
    'arena'
  ),
  asset(
    'scene.arena.key-5',
    ASSET_BUNDLE_IDS.arena,
    'key5',
    arenaKey5Image,
    535,
    202,
    'arena'
  ),
  asset(
    'scene.arena.key-6',
    ASSET_BUNDLE_IDS.arena,
    'key6',
    arenaKey6Image,
    568,
    195,
    'arena'
  ),
  asset(
    'scene.arena.key-7',
    ASSET_BUNDLE_IDS.arena,
    'key7',
    arenaKey7Image,
    558,
    205,
    'arena'
  ),
  asset(
    'scene.arena.key-8',
    ASSET_BUNDLE_IDS.arena,
    'key8',
    arenaKey8Image,
    549,
    188,
    'arena'
  ),
  asset(
    'scene.arena.key-9',
    ASSET_BUNDLE_IDS.arena,
    'key9',
    arenaKey9Image,
    585,
    204,
    'arena'
  ),
  asset(
    'scene.arena.key-10',
    ASSET_BUNDLE_IDS.arena,
    'key10',
    arenaKey10Image,
    552,
    191,
    'arena'
  ),
  asset(
    'scene.arena.key-11',
    ASSET_BUNDLE_IDS.arena,
    'key11',
    arenaKey11Image,
    589,
    191,
    'arena'
  ),
  asset(
    'scene.arena.key-12',
    ASSET_BUNDLE_IDS.arena,
    'key12',
    arenaKey12Image,
    609,
    249,
    'arena'
  ),
  asset(
    'scene.arena.defeat-x',
    ASSET_BUNDLE_IDS.arena,
    'defeatX',
    arenaDefeatXImage,
    74,
    70,
    'arena'
  ),
  asset(
    'scene.arena.play-button',
    ASSET_BUNDLE_IDS.arena,
    'playButton',
    arenaPlayButtonImage,
    215,
    215,
    'arena'
  ),
  asset(
    'scene.arena.retire-button',
    ASSET_BUNDLE_IDS.arena,
    'retireButton',
    arenaRetireButtonImage,
    107,
    47,
    'arena'
  ),
  asset(
    'scene.arena.retire-container',
    ASSET_BUNDLE_IDS.arena,
    'retireContainer',
    arenaRetireContainerImage,
    1920,
    1080,
    'arena'
  ),
  asset(
    'scene.arena.confirm',
    ASSET_BUNDLE_IDS.arena,
    'confirmButton',
    arenaConfirmImage,
    232,
    67,
    'arena'
  ),
  asset(
    'scene.arena.cancel',
    ASSET_BUNDLE_IDS.arena,
    'cancelButton',
    arenaCancelImage,
    230,
    65,
    'arena'
  ),
  asset(
    'scene.arena.vertical-slider',
    ASSET_BUNDLE_IDS.arena,
    'verticalSlider',
    verticalSliderImage,
    34,
    94,
    'arena'
  ),
  asset(
    'scene.arena.card-add-aura',
    ASSET_BUNDLE_IDS.arena,
    'cardAddAura',
    cardAddAuraImage,
    500,
    500,
    'arena'
  ),
  asset(
    'scene.tavern-brawl.play-button',
    ASSET_BUNDLE_IDS.tavernBrawl,
    'playButton',
    tavernBrawlPlayButtonImage,
    259,
    259,
    'tavern-brawl'
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
    'scene.deck-selection.pagination-next-button',
    ASSET_BUNDLE_IDS.deckSelection,
    'paginationNextButton',
    deckSelectionPaginationNextImage,
    88,
    49,
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
    'scene.deck-selection.rank-medal-1',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal1',
    rankMedal1Image,
    124,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-2',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal2',
    rankMedal2Image,
    122,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-3',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal3',
    rankMedal3Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-4',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal4',
    rankMedal4Image,
    123,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-5',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal5',
    rankMedal5Image,
    123,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-6',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal6',
    rankMedal6Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-7',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal7',
    rankMedal7Image,
    124,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-8',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal8',
    rankMedal8Image,
    124,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-9',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal9',
    rankMedal9Image,
    122,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-10',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal10',
    rankMedal10Image,
    124,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-11',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal11',
    rankMedal11Image,
    122,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-12',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal12',
    rankMedal12Image,
    122,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-13',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal13',
    rankMedal13Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-14',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal14',
    rankMedal14Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-15',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal15',
    rankMedal15Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-16',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal16',
    rankMedal16Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-17',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal17',
    rankMedal17Image,
    124,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-18',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal18',
    rankMedal18Image,
    123,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-19',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal19',
    rankMedal19Image,
    122,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-20',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal20',
    rankMedal20Image,
    122,
    159,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-21',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal21',
    rankMedal21Image,
    124,
    159,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-22',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal22',
    rankMedal22Image,
    124,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-23',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal23',
    rankMedal23Image,
    124,
    160,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-24',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal24',
    rankMedal24Image,
    123,
    161,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-25',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankMedal25',
    rankMedal25Image,
    123,
    159,
    'deck-selection'
  ),
  asset(
    'scene.deck-selection.rank-medal-legend',
    ASSET_BUNDLE_IDS.deckSelection,
    'rankLegend',
    rankLegendImage,
    117,
    135,
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
    'scene.menu-settings.resolution-field',
    ASSET_BUNDLE_IDS.menuSettings,
    'resolutionField',
    settingsDropDownListImage,
    344,
    76,
    'menu-settings'
  ),
  asset(
    'scene.menu-settings.resolution-button',
    ASSET_BUNDLE_IDS.menuSettings,
    'resolutionButton',
    settingsDropDownButtonImage,
    62,
    42,
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
    'scene.game-settings.base-frame-large',
    ASSET_BUNDLE_IDS.gameSettings,
    'baseFrameLarge',
    settingsBaseFrameLargeImage,
    398,
    109,
    'game-settings'
  ),
  asset(
    'scene.game-settings.concede-button',
    ASSET_BUNDLE_IDS.gameSettings,
    'concedeButton',
    settingsConcedeImage,
    294,
    97,
    'game-settings'
  ),
  asset(
    'scene.game-settings.restart-button',
    ASSET_BUNDLE_IDS.gameSettings,
    'restartButton',
    settingsRestartImage,
    294,
    97,
    'game-settings'
  ),
  asset(
    'scene.game-settings.quit-button',
    ASSET_BUNDLE_IDS.gameSettings,
    'quitButton',
    settingsQuitImage,
    294,
    97,
    'game-settings'
  ),
  asset(
    'scene.game.board-base',
    ASSET_BUNDLE_IDS.game,
    'boardBase',
    gameBoardBaseImage,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-1',
    ASSET_BUNDLE_IDS.game,
    'board1',
    gameBoard1Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-2',
    ASSET_BUNDLE_IDS.game,
    'board2',
    gameBoard2Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-3',
    ASSET_BUNDLE_IDS.game,
    'board3',
    gameBoard3Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-4',
    ASSET_BUNDLE_IDS.game,
    'board4',
    gameBoard4Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-5',
    ASSET_BUNDLE_IDS.game,
    'board5',
    gameBoard5Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-6',
    ASSET_BUNDLE_IDS.game,
    'board6',
    gameBoard6Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-7',
    ASSET_BUNDLE_IDS.game,
    'board7',
    gameBoard7Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-8',
    ASSET_BUNDLE_IDS.game,
    'board8',
    gameBoard8Image,
    1920,
    1080,
    'game-scene'
  ),
  asset(
    'scene.game.board-9',
    ASSET_BUNDLE_IDS.game,
    'board9',
    gameBoard9Image,
    1920,
    1080,
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
    'scene.game.minion-frame-premium',
    ASSET_BUNDLE_IDS.game,
    'premiumMinionFrame',
    premiumMinionFrameImage,
    119,
    161,
    'game-scene'
  ),
  asset(
    'scene.game.fatigue',
    ASSET_BUNDLE_IDS.game,
    'fatigue',
    fatigueImage,
    420,
    727,
    'game-scene'
  ),
  asset(
    'scene.game.damage-indicator',
    ASSET_BUNDLE_IDS.game,
    'damageIndicator',
    damageIndicatorImage,
    159,
    163,
    'game-scene'
  ),
  asset(
    'scene.game.heal-indicator',
    ASSET_BUNDLE_IDS.game,
    'healIndicator',
    healIndicatorImage,
    192,
    197,
    'game-scene'
  ),
  asset(
    'scene.game.history-local',
    ASSET_BUNDLE_IDS.game,
    'historyLocal',
    historyLocalImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-remote',
    ASSET_BUNDLE_IDS.game,
    'historyRemote',
    historyRemoteImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-local-attack',
    ASSET_BUNDLE_IDS.game,
    'historyLocalAttack',
    historyLocalAttackImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-local-trigger',
    ASSET_BUNDLE_IDS.game,
    'historyLocalTrigger',
    historyLocalTriggerImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-remote-attack',
    ASSET_BUNDLE_IDS.game,
    'historyRemoteAttack',
    historyRemoteAttackImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-remote-trigger',
    ASSET_BUNDLE_IDS.game,
    'historyRemoteTrigger',
    historyRemoteTriggerImage,
    75,
    75,
    'game-scene'
  ),
  asset(
    'scene.game.history-arrow',
    ASSET_BUNDLE_IDS.game,
    'historyArrow',
    historyArrowImage,
    91,
    92,
    'game-scene'
  ),
  asset(
    'scene.game.ghost-spotlight',
    ASSET_BUNDLE_IDS.game,
    'ghostSpotlight',
    ghostSpotlightImage,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.ghost-dissolve',
    ASSET_BUNDLE_IDS.game,
    'ghostDissolve',
    ghostDissolveImage,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.burn-noise',
    ASSET_BUNDLE_IDS.game,
    'burnNoise',
    burnNoiseImage,
    512,
    512,
    'game-scene'
  ),
  asset(
    'scene.game.history-burn-card',
    ASSET_BUNDLE_IDS.game,
    'historyBurnCard',
    historyBurnCardImage,
    417,
    656,
    'game-scene'
  ),
  asset(
    'scene.game.history-burn-thumb',
    ASSET_BUNDLE_IDS.game,
    'historyBurnThumb',
    historyBurnThumbImage,
    100,
    100,
    'game-scene'
  ),
  asset(
    'scene.game.history-secret-card',
    ASSET_BUNDLE_IDS.game,
    'historySecretCard',
    historySecretCardImage,
    288,
    392,
    'game-scene'
  ),
  asset(
    'scene.game.history-secret-thumb',
    ASSET_BUNDLE_IDS.game,
    'historySecretThumb',
    historySecretThumbImage,
    100,
    100,
    'game-scene'
  ),
  asset(
    'scene.game.history-fatigue-card',
    ASSET_BUNDLE_IDS.game,
    'historyFatigueCard',
    historyFatigueCardImage,
    288,
    392,
    'game-scene'
  ),
  asset(
    'scene.game.history-fatigue-thumb',
    ASSET_BUNDLE_IDS.game,
    'historyFatigueThumb',
    historyFatigueThumbImage,
    100,
    100,
    'game-scene'
  ),
  asset(
    'scene.game.secret',
    ASSET_BUNDLE_IDS.game,
    'secret',
    secretImage,
    112,
    112,
    'game-scene'
  ),
  asset(
    'scene.game.quest',
    ASSET_BUNDLE_IDS.game,
    'quest',
    questImage,
    95,
    107,
    'game-scene'
  ),
  asset(
    'scene.game.quest-arrow',
    ASSET_BUNDLE_IDS.game,
    'questArrow',
    questArrowImage,
    206,
    198,
    'game-scene'
  ),
  asset(
    'scene.game.secret-revealed-screen',
    ASSET_BUNDLE_IDS.game,
    'secretRevealedScreen',
    secretRevealedScreenImage,
    761,
    409,
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
    'scene.game.minion-frame-legendary-premium',
    ASSET_BUNDLE_IDS.game,
    'premiumMinionFrameLegendary',
    premiumMinionFrameLegendaryImage,
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
    'scene.game.minion-taunt-premium',
    ASSET_BUNDLE_IDS.game,
    'premiumMinionTaunt',
    premiumMinionTauntImage,
    136,
    183,
    'game-scene'
  ),
  asset(
    'scene.game.minion-battlecry',
    ASSET_BUNDLE_IDS.game,
    'minionBattlecry',
    minionBattlecryImage,
    284,
    274,
    'game-scene'
  ),
  asset(
    'scene.game.minion-enrage',
    ASSET_BUNDLE_IDS.game,
    'minionEnrage',
    minionEnrageImage,
    105,
    141,
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
    'scene.game.hero-frozen',
    ASSET_BUNDLE_IDS.game,
    'heroFrozen',
    heroFrozenImage,
    345,
    433,
    'game-scene'
  ),
  asset(
    'scene.game.hero-immune',
    ASSET_BUNDLE_IDS.game,
    'heroImmune',
    heroImmuneImage,
    240,
    239,
    'game-scene'
  ),
  asset(
    'scene.game.minion-frozen',
    ASSET_BUNDLE_IDS.game,
    'minionFrozen',
    minionFrozenImage,
    160,
    210,
    'game-scene'
  ),
  asset(
    'scene.game.minion-windfury',
    ASSET_BUNDLE_IDS.game,
    'minionWindfury',
    minionWindfuryImage,
    51,
    48,
    'game-scene'
  ),
  asset(
    'scene.game.minion-spell-damage',
    ASSET_BUNDLE_IDS.game,
    'minionSpellDamage',
    minionSpellDamageImage,
    43,
    45,
    'game-scene'
  ),
  asset(
    'scene.game.minion-lifesteal',
    ASSET_BUNDLE_IDS.game,
    'minionLifesteal',
    minionLifestealImage,
    43,
    41,
    'game-scene'
  ),
  asset(
    'scene.game.minion-aura',
    ASSET_BUNDLE_IDS.game,
    'minionAura',
    minionAuraImage,
    38,
    38,
    'game-scene'
  ),
  asset(
    'scene.game.minion-elusive',
    ASSET_BUNDLE_IDS.game,
    'minionElusive',
    minionElusiveImage,
    113,
    153,
    'game-scene'
  ),
  asset(
    'scene.game.minion-immune',
    ASSET_BUNDLE_IDS.game,
    'minionImmune',
    minionImmuneImage,
    125,
    167,
    'game-scene'
  ),
  asset(
    'scene.game.minion-stealth',
    ASSET_BUNDLE_IDS.game,
    'minionStealth',
    minionStealthImage,
    113,
    153,
    'game-scene'
  ),
  asset(
    'scene.game.board-trigger',
    ASSET_BUNDLE_IDS.game,
    'boardTrigger',
    minionTriggerImage,
    41,
    44,
    'game-scene'
  ),
  asset(
    'scene.game.board-inspire',
    ASSET_BUNDLE_IDS.game,
    'boardInspire',
    minionInspireImage,
    43,
    38,
    'game-scene'
  ),
  asset(
    'scene.game.board-deathrattle',
    ASSET_BUNDLE_IDS.game,
    'boardDeathrattle',
    minionDeathrattleImage,
    80,
    53,
    'game-scene'
  ),
  asset(
    'scene.game.board-poisonous',
    ASSET_BUNDLE_IDS.game,
    'boardPoisonous',
    minionPoisonousImage,
    39,
    55,
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
    'scene.game.hero-armor',
    ASSET_BUNDLE_IDS.game,
    'heroArmor',
    heroArmorImage,
    163,
    200,
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
    'scene.game.weapon-premium',
    ASSET_BUNDLE_IDS.game,
    'premiumWeapon',
    premiumWeaponImage,
    172,
    146,
    'game-scene'
  ),
  asset(
    'scene.game.minion-play-aura',
    ASSET_BUNDLE_IDS.game,
    'minionPlayAura',
    minionPlayAuraImage,
    698,
    927,
    'game-scene'
  ),
  asset(
    'scene.game.spell-play-aura',
    ASSET_BUNDLE_IDS.game,
    'spellPlayAura',
    spellPlayAuraImage,
    720,
    1000,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-01',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight1',
    playSpotlight1Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-02',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight2',
    playSpotlight2Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-03',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight3',
    playSpotlight3Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-04',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight4',
    playSpotlight4Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-05',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight5',
    playSpotlight5Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-06',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight6',
    playSpotlight6Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-07',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight7',
    playSpotlight7Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.play-spotlight-08',
    ASSET_BUNDLE_IDS.game,
    'playSpotlight8',
    playSpotlight8Image,
    256,
    256,
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
    'scene.game.hero-power-aura-1',
    ASSET_BUNDLE_IDS.game,
    'heroPowerAura1',
    cardAddAuraImage,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-aura-2',
    ASSET_BUNDLE_IDS.game,
    'heroPowerAura2',
    heroPowerAura2Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-aura-3',
    ASSET_BUNDLE_IDS.game,
    'heroPowerAura3',
    heroPowerAura3Image,
    256,
    256,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-aura-4',
    ASSET_BUNDLE_IDS.game,
    'heroPowerAura4',
    heroPowerAura4Image,
    256,
    256,
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
    'scene.game.deck-sliced',
    ASSET_BUNDLE_IDS.game,
    'deckSliced',
    gameDeckSlicedImage,
    47,
    180,
    'game-scene'
  ),
  asset(
    'scene.game.deck-info',
    ASSET_BUNDLE_IDS.game,
    'deckInfo',
    gameDeckInfoImage,
    246,
    131,
    'game-scene'
  ),
  asset(
    'scene.game.fatigue-deck',
    ASSET_BUNDLE_IDS.game,
    'fatigueDeck',
    gameFatigueDeckImage,
    60,
    191,
    'game-scene'
  ),
  asset(
    'scene.game.mana-overload',
    ASSET_BUNDLE_IDS.game,
    'manaOverload',
    manaOverloadImage,
    49,
    48,
    'game-scene'
  ),
  asset(
    'scene.game.mana-available',
    ASSET_BUNDLE_IDS.game,
    'manaAvailable',
    manaAvailableImage,
    45,
    47,
    'game-scene'
  ),
  asset(
    'scene.game.mana-spent',
    ASSET_BUNDLE_IDS.game,
    'manaSpent',
    manaSpentImage,
    44,
    45,
    'game-scene'
  ),
  asset(
    'scene.game.mana-highlighted',
    ASSET_BUNDLE_IDS.game,
    'manaHighlighted',
    manaHighlightedImage,
    45,
    47,
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
    'scene.game.mulligan-opponent-still-choosing',
    ASSET_BUNDLE_IDS.game,
    'mulliganOpponentStillChoosing',
    mulliganOpponentStillChoosingImage,
    636,
    198,
    'game-scene'
  ),
  asset(
    'scene.game.toggle-view-button',
    ASSET_BUNDLE_IDS.game,
    'toggleViewButton',
    toggleViewButtonImage,
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
    'scene.game.hero-power-back.premium',
    ASSET_BUNDLE_IDS.game,
    'premiumHeroPowerBack',
    premiumHeroPowerBackImage,
    145,
    145,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-front',
    ASSET_BUNDLE_IDS.game,
    'heroPowerFront',
    heroPowerFrontImage,
    150,
    150,
    'game-scene'
  ),
  asset(
    'scene.game.hero-power-front.premium',
    ASSET_BUNDLE_IDS.game,
    'premiumHeroPowerFront',
    premiumHeroPowerFrontImage,
    151,
    150,
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
  asset(
    'scene.game.discover-history-hero-power',
    ASSET_BUNDLE_IDS.game,
    'discoverHistoryHeroPower',
    discoverHistoryHeroPowerImage,
    620,
    903,
    'game-scene'
  ),
  asset(
    'scene.game.summon-totem',
    ASSET_BUNDLE_IDS.game,
    'summonTotem',
    summonTotemImage,
    242,
    237,
    'game-scene'
  ),
  asset(
    'scene.game.tank-up-hammer',
    ASSET_BUNDLE_IDS.game,
    'tankUpHammer',
    tankUpHammerImage,
    300,
    474,
    'game-scene'
  ),
  asset(
    'scene.game.effect-circle-1',
    ASSET_BUNDLE_IDS.game,
    'effectCircle1',
    effectCircle1Image,
    256,
    256,
    'game-scene'
  ),
  ...Object.entries(HERO_POWER_ASSET_SOURCES).map(([key, source]) =>
    asset(
      `scene.game.hero-power.${key}`,
      ASSET_BUNDLE_IDS.game,
      key,
      source,
      500,
      500,
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
    'scene.game.arrow-circle',
    ASSET_BUNDLE_IDS.game,
    'arrowCircle',
    arrowCircleImage,
    112,
    112,
    'game-scene'
  ),
  asset(
    'scene.game.arcane-dust',
    ASSET_BUNDLE_IDS.game,
    'arcaneDust',
    arcaneDustImage,
    180,
    243,
    'game-scene'
  ),
  asset(
    'scene.game.win-screen',
    ASSET_BUNDLE_IDS.game,
    'winScreen',
    winScreenImage,
    1374,
    1145,
    'game-scene'
  ),
  asset(
    'scene.game.defeat-screen',
    ASSET_BUNDLE_IDS.game,
    'defeatScreen',
    defeatScreenImage,
    1374,
    1145,
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
    'deck-presentation.button-frame',
    ASSET_BUNDLE_IDS.deckPresentation,
    'deckButtonFrame',
    loadDeckButtonImage,
    239,
    107,
    'deck-presentation'
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
    'scene.card-preview.upgrade-window',
    ASSET_BUNDLE_IDS.cardPreview,
    'upgradeWindow',
    upgradeWindowImage,
    422,
    250,
    'card-preview'
  ),
  asset(
    'scene.card-preview.upgrade-button',
    ASSET_BUNDLE_IDS.cardPreview,
    'upgradeButton',
    upgradeButtonImage,
    154,
    88,
    'card-preview'
  ),
  asset(
    'scene.card-preview.disenchant-button',
    ASSET_BUNDLE_IDS.cardPreview,
    'disenchantButton',
    disenchantButtonImage,
    154,
    88,
    'card-preview'
  ),
  asset(
    'scene.card-preview.assembly-spark',
    ASSET_BUNDLE_IDS.cardPreview,
    'assemblySpark',
    playSpotlight1Image,
    256,
    256,
    'card-preview'
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
    'deck-presentation.anduin-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'anduinDeckPortrait',
    anduinDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.garrosh-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'garroshDeckPortrait',
    garroshDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.guldan-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'guldanDeckPortrait',
    guldanDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.jaina-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'jainaDeckPortrait',
    jainaDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.malfurion-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'malfurionDeckPortrait',
    malfurionDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.rexxar-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'rexxarDeckPortrait',
    rexxarDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.thrall-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'thrallDeckPortrait',
    thrallDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.uther-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'utherDeckPortrait',
    utherDeckPortraitImage,
    512,
    512,
    'deck-presentation'
  ),
  asset(
    'deck-presentation.valeera-portrait',
    ASSET_BUNDLE_IDS.deckPresentation,
    'valeeraDeckPortrait',
    valeeraDeckPortraitImage,
    512,
    512,
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
  asset(
    'ui.generic-dialog',
    ASSET_BUNDLE_IDS.sharedUI,
    'genericDialog',
    genericDialogImage,
    1237,
    355,
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
  asset(
    'scene.game-loading.overlay',
    ASSET_BUNDLE_IDS.gameLoading,
    'overlay',
    loadScreenOverlayImage,
    855,
    338,
    'game-loading'
  ),
  ...[
    gameBoard1Image,
    gameBoard2Image,
    gameBoard3Image,
    gameBoard4Image,
    gameBoard5Image,
    gameBoard6Image,
    gameBoard7Image,
    gameBoard8Image,
    gameBoard9Image
  ].map((source, index) =>
    asset(
      'scene.game-loading.board-' + (index + 1),
      GAME_BOARD_BUNDLE_IDS[index]!,
      'board',
      source,
      1920,
      1080,
      'game-loading'
    )
  ),
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
  ).map((definition) => ({
    alias: definition.alias,
    src: definition.source.src
  }))
}))

export const ASSETS_MANIFEST: AssetsManifest = { bundles: manifestBundles }

for (const bundle of manifestBundles) {
  const entries = Object.fromEntries(
    bundle.assets.map((entry) => [entry.alias, entry.src])
  ) as Record<string, string>
  registerAssetBundle(bundle.name, entries, {
    // Pixi pools alpha-mask filters across scenes. Destroying a card-frame
    // TextureSource leaves those pooled filters with a dead WebGPU bind group,
    // so card rendering assets live until the renderer itself is destroyed.
    // Main-menu artwork and dust are preloaded at startup and reused on return.
    persistent:
      bundle.name === ASSET_BUNDLE_IDS.cardRendering ||
      bundle.name === ASSET_BUNDLE_IDS.mainMenu
  })
}

export interface MainMenuAssets {
  dustRound: Texture
  dustTriangle: Texture
  table: Texture
  box: Texture
  leftLid: Texture
  rightLid: Texture
  centerPart: Texture
  centerPartMenu: Texture
  buttonPlay: Texture
  buttonCollection: Texture
  buttonArena: Texture
  buttonTavern: Texture
}

export interface TavernBrawlAssets {
  background: Texture
  playButton: Texture
}

export const ARENA_KEY_ASSET_KEYS = [
  'key0',
  'key1',
  'key2',
  'key3',
  'key4',
  'key5',
  'key6',
  'key7',
  'key8',
  'key9',
  'key10',
  'key11',
  'key12'
] as const

export interface ArenaAssets extends Record<
  (typeof ARENA_KEY_ASSET_KEYS)[number],
  Texture
> {
  rewardBox: Texture
  confirmReward: Texture
  rewardDust: Texture
  background: Texture
  backgroundOngoing: Texture
  defeatX: Texture
  playButton: Texture
  retireButton: Texture
  retireContainer: Texture
  confirmButton: Texture
  cancelButton: Texture
  verticalSlider: Texture
  cardAddAura: Texture
}

export const RANK_MEDAL_ASSET_KEYS = [
  'rankMedal1',
  'rankMedal2',
  'rankMedal3',
  'rankMedal4',
  'rankMedal5',
  'rankMedal6',
  'rankMedal7',
  'rankMedal8',
  'rankMedal9',
  'rankMedal10',
  'rankMedal11',
  'rankMedal12',
  'rankMedal13',
  'rankMedal14',
  'rankMedal15',
  'rankMedal16',
  'rankMedal17',
  'rankMedal18',
  'rankMedal19',
  'rankMedal20',
  'rankMedal21',
  'rankMedal22',
  'rankMedal23',
  'rankMedal24',
  'rankMedal25',
  'rankLegend'
] as const

export interface DeckSelectionAssets extends Record<
  (typeof RANK_MEDAL_ASSET_KEYS)[number],
  Texture
> {
  panel: Texture
  paginationNextButton: Texture
  playButton: Texture
}

export interface DeckPresentationAssets extends Record<HeroAssetKey, Texture> {
  deckButtonFrame: Texture
  anduinDeckPortrait: Texture
  garroshDeckPortrait: Texture
  guldanDeckPortrait: Texture
  jainaDeckPortrait: Texture
  malfurionDeckPortrait: Texture
  rexxarDeckPortrait: Texture
  thrallDeckPortrait: Texture
  utherDeckPortrait: Texture
  valeeraDeckPortrait: Texture
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
  heroPowerAura1: Texture
  heroPowerAura2: Texture
  heroPowerAura3: Texture
  heroPowerAura4: Texture
  boardBase: Texture
  board1: Texture
  board2: Texture
  board3: Texture
  board4: Texture
  board5: Texture
  board6: Texture
  board7: Texture
  board8: Texture
  board9: Texture
  fatigue: Texture
  damageIndicator: Texture
  healIndicator: Texture
  historyLocal: Texture
  historyRemote: Texture
  historyLocalAttack: Texture
  historyLocalTrigger: Texture
  historyRemoteAttack: Texture
  historyRemoteTrigger: Texture
  historyArrow: Texture
  burnNoise: Texture
  ghostDissolve: Texture
  ghostSpotlight: Texture
  historyBurnCard: Texture
  historyBurnThumb: Texture
  historySecretCard: Texture
  historySecretThumb: Texture
  historyFatigueCard: Texture
  historyFatigueThumb: Texture
  secret: Texture
  quest: Texture
  questArrow: Texture
  secretRevealedScreen: Texture
  minionFrame: Texture
  premiumMinionFrame: Texture
  minionFrameLegendary: Texture
  premiumMinionFrameLegendary: Texture
  minionTaunt: Texture
  premiumMinionTaunt: Texture
  minionBattlecry: Texture
  minionEnrage: Texture
  minionDivineShield: Texture
  heroFrozen: Texture
  heroImmune: Texture
  minionFrozen: Texture
  minionWindfury: Texture
  minionSpellDamage: Texture
  minionLifesteal: Texture
  minionAura: Texture
  minionElusive: Texture
  minionImmune: Texture
  minionStealth: Texture
  boardTrigger: Texture
  boardInspire: Texture
  boardDeathrattle: Texture
  boardPoisonous: Texture
  minionAttack: Texture
  minionHealth: Texture
  heroArmor: Texture
  minionWillDie: Texture
  weapon: Texture
  premiumWeapon: Texture
  minionSummonRays: Texture
  spellPlayAura: Texture
  minionPlayAura: Texture
  playSpotlight1: Texture
  playSpotlight2: Texture
  playSpotlight3: Texture
  playSpotlight4: Texture
  playSpotlight5: Texture
  playSpotlight6: Texture
  playSpotlight7: Texture
  playSpotlight8: Texture
  deck: Texture
  deckSliced: Texture
  deckInfo: Texture
  fatigueDeck: Texture
  manaAvailable: Texture
  manaSpent: Texture
  manaHighlighted: Texture
  manaOverload: Texture
  endTurn: Texture
  toggleViewButton: Texture
  enemyTurn: Texture
  yourTurn: Texture
  cardBack: Texture
  startOfGameVs: Texture
  mulliganAnnouncement: Texture
  mulliganReplaceCross: Texture
  mulliganReplacedLabel: Texture
  confirmMulliganButton: Texture
  mulliganOpponentStillChoosing: Texture
  mulliganCoinAnnouncement: Texture
  heroPowerBack: Texture
  premiumHeroPowerBack: Texture
  heroPowerFront: Texture
  premiumHeroPowerFront: Texture
  heroPowerMana: Texture
  discoverHistoryHeroPower: Texture
  summonTotem: Texture
  tankUpHammer: Texture
  effectCircle1: Texture
  arrowBody: Texture
  arrowHead: Texture
  arrowCircle: Texture
  winScreen: Texture
  arcaneDust: Texture
  defeatScreen: Texture
}

export interface MenuSettingsAssets {
  background: Texture
  resolutionField: Texture
  resolutionButton: Texture
}

export interface GameSettingsAssets {
  background: Texture
  baseFrameLarge: Texture
  concedeButton: Texture
  restartButton: Texture
  quitButton: Texture
}

export interface SharedUIAssets {
  backButton: Texture
  doneButton: Texture
  genericDialog: Texture
}

export interface CollectionAssets {
  background: Texture
  cover: Texture
  coverLock: Texture
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
  assemblySpark: Texture
  detailContainer: Texture
  upgradeWindow: Texture
  upgradeButton: Texture
  disenchantButton: Texture
}

export interface GameLoadingAssets {
  overlay: Texture
}
export interface GameBoardAssets {
  board: Texture
}
