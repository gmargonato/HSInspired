import armorImage from '@assets/images/cards/armor.png'
import attackImage from '@assets/images/cards/attack.png'
import cardNameImage from '@assets/images/cards/card-name.png'
import colorMask1FrameMinionImage from '@assets/images/cards/color-mask-1-frame-minion.png'
import colorMask1FrameSpellImage from '@assets/images/cards/color-mask-1-frame-spell.png'
import colorMask2FrameMinionImage from '@assets/images/cards/color-mask-2-frame-minion.png'
import colorMask2FrameSpellImage from '@assets/images/cards/color-mask-2-frame-spell.png'
import frameHeroImage from '@assets/images/cards/frame-hero.png'
import frameMinionImage from '@assets/images/cards/frame-minion.png'
import frameSpellImage from '@assets/images/cards/frame-spell.png'
import frameWeaponImage from '@assets/images/cards/frame-weapon.png'
import healthImage from '@assets/images/cards/health.png'
import legendaryImage from '@assets/images/cards/legendary.png'
import manaImage from '@assets/images/cards/mana.png'
import raceBannerImage from '@assets/images/cards/race-banner.png'
import rarityCommonImage from '@assets/images/cards/rarity-common.png'
import rarityEpicImage from '@assets/images/cards/rarity-epic.png'
import rarityLegendaryImage from '@assets/images/cards/rarity-legendary.png'
import rarityRareImage from '@assets/images/cards/rarity-rare.png'
import silenceImage from '@assets/images/cards/silence.png'
import shadowManaImage from '@assets/images/cards/shadow-mana.png'
import weaponAttackImage from '@assets/images/cards/weapon-attack.png'
import weaponDurabilityImage from '@assets/images/cards/weapon-durability.png'
import weaponNameImage from '@assets/images/cards/weapon-name.png'

export interface CardAssetDefinition {
  readonly key: string
  readonly source: string
  readonly fileName: string
  readonly authoredWidth: number
  readonly authoredHeight: number
}

function cardAsset(
  key: string,
  fileName: string,
  source: string,
  authoredWidth: number,
  authoredHeight: number
): CardAssetDefinition {
  return { key, fileName, source, authoredWidth, authoredHeight }
}

export const CARD_ASSET_DEFINITIONS = [
  cardAsset('card.stat.armor', 'armor.png', armorImage, 163, 200),
  cardAsset('card.stat.attack', 'attack.png', attackImage, 175, 214),
  cardAsset('card.name', 'card-name.png', cardNameImage, 665, 198),
  cardAsset('card.frame.hero', 'frame-hero.png', frameHeroImage, 620, 905),
  cardAsset('card.frame.minion', 'frame-minion.png', frameMinionImage, 620, 905),
  cardAsset(
    'card.frame.minion.class-mask-1',
    'color-mask-1-frame-minion.png',
    colorMask1FrameMinionImage,
    594,
    866
  ),
  cardAsset(
    'card.frame.minion.class-mask-2',
    'color-mask-2-frame-minion.png',
    colorMask2FrameMinionImage,
    557,
    538
  ),
  cardAsset('card.frame.spell', 'frame-spell.png', frameSpellImage, 620, 905),
  cardAsset(
    'card.frame.spell.class-mask-1',
    'color-mask-1-frame-spell.png',
    colorMask1FrameSpellImage,
    606,
    883
  ),
  cardAsset(
    'card.frame.spell.class-mask-2',
    'color-mask-2-frame-spell.png',
    colorMask2FrameSpellImage,
    549,
    473
  ),
  cardAsset('card.frame.weapon', 'frame-weapon.png', frameWeaponImage, 620, 905),
  cardAsset('card.stat.health', 'health.png', healthImage, 136, 192),
  cardAsset('card.frame.legendary', 'legendary.png', legendaryImage, 436, 317),
  cardAsset('card.stat.mana', 'mana.png', manaImage, 174, 165),
  cardAsset('card.shadow.mana', 'shadow-mana.png', shadowManaImage, 267, 270),
  cardAsset('card.race-banner', 'race-banner.png', raceBannerImage, 408, 69),
  cardAsset('card.rarity.common', 'rarity-common.png', rarityCommonImage, 58, 79),
  cardAsset('card.rarity.epic', 'rarity-epic.png', rarityEpicImage, 58, 79),
  cardAsset(
    'card.rarity.legendary',
    'rarity-legendary.png',
    rarityLegendaryImage,
    58,
    79
  ),
  cardAsset('card.rarity.rare', 'rarity-rare.png', rarityRareImage, 58, 79),
  cardAsset('card.overlay.silence', 'silence.png', silenceImage, 327, 265),
  cardAsset(
    'card.stat.weapon-attack',
    'weapon-attack.png',
    weaponAttackImage,
    171,
    180
  ),
  cardAsset(
    'card.stat.weapon-durability',
    'weapon-durability.png',
    weaponDurabilityImage,
    164,
    179
  ),
  cardAsset('card.name.weapon', 'weapon-name.png', weaponNameImage, 665, 198)
] as const

const byName = new Map(
  CARD_ASSET_DEFINITIONS.map((definition) => [
    definition.fileName.toLowerCase(),
    definition
  ])
)

export function resolveCardAssetDefinition(keyOrFileName: string): CardAssetDefinition {
  const definition =
    CARD_ASSET_DEFINITIONS.find((candidate) => candidate.key === keyOrFileName) ??
    byName.get(keyOrFileName.toLowerCase())
  if (!definition) throw new Error(`Unknown card asset key: ${keyOrFileName}`)
  return definition
}

export function hasCardAssetDefinition(keyOrFileName: string): boolean {
  return (
    CARD_ASSET_DEFINITIONS.some((definition) => definition.key === keyOrFileName) ||
    byName.has(keyOrFileName.toLowerCase())
  )
}
