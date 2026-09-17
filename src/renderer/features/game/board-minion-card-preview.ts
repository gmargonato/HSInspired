import { cthunCardRulesText } from '../../../game/match/cthun'
import type {
  MinionCardDefinition,
  WeaponCardDefinition
} from '../../../game/content/cards'
import type { BoardMinion, BoardWeapon } from '../../../game/match'
import {
  minionAttackColor,
  minionHealthColor
} from '../../rendering/minions/minion-stat-presentation'

export interface BoardMinionCardPreviewModel {
  readonly card: MinionCardDefinition
  readonly silenced: boolean
  readonly attackColor: number
  readonly healthColor: number
}

export interface BoardMinionCardPreviewBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface BoardMinionCardPreviewLayout {
  readonly scale: number
  readonly gap: number
  readonly viewportPadding: number
  readonly viewportWidth: number
  readonly viewportHeight: number
}

export type BoardMinionCardPreviewSide = 'left' | 'right'

export interface BoardMinionCardPreviewTargetingState {
  readonly cardTargeting: boolean
  readonly heroPowerTargeting: boolean
  readonly combatTargeting: boolean
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Full-card hover previews stay hidden while any board targeting mode is active. */
export function canShowBoardMinionCardPreview(
  targeting: BoardMinionCardPreviewTargetingState
): boolean {
  return !(
    targeting.cardTargeting ||
    targeting.heroPowerTargeting ||
    targeting.combatTargeting
  )
}

/** Creates a display-only full card whose stats reflect one live board instance. */
export function boardMinionCardPreviewModel(
  definition: MinionCardDefinition,
  minion: BoardMinion
): BoardMinionCardPreviewModel {
  const baseAttack = minion.baseAttack ?? definition.attack
  const baseHealth = minion.baseHealth ?? definition.health
  return {
    card: {
      ...definition,
      rulesText: cthunCardRulesText(minion, definition.rulesText),
      attack: minion.attack,
      health: minion.health
    },
    silenced: minion.silenced === true,
    attackColor: minionAttackColor(minion.attack, baseAttack),
    healthColor: minionHealthColor(minion.health, minion.maxHealth, baseHealth)
  }
}

/** Stable key used to avoid rebuilding an unchanged hovered preview. */
export function boardMinionCardPreviewKey(minion: BoardMinion): string {
  return [
    minion.instanceId,
    minion.cardId,
    minion.attack,
    minion.health,
    minion.maxHealth,
    minion.baseAttack ?? '',
    minion.baseHealth ?? '',
    minion.silenced === true ? 1 : 0,
    minion.enchantments?.some((entry) => entry.keywords?.includes('taunt')) ? 1 : 0
  ].join(':')
}

/** Positions a scaled card beside the source and keeps it on the design canvas. */
export function positionBoardMinionCardPreview(
  source: BoardMinionCardPreviewBounds,
  cardSize: { readonly width: number; readonly height: number },
  layout: BoardMinionCardPreviewLayout,
  side: BoardMinionCardPreviewSide = 'right'
): { readonly x: number; readonly y: number } {
  const previewWidth = cardSize.width * layout.scale
  const previewHeight = cardSize.height * layout.scale
  const minX = layout.viewportPadding
  const minY = layout.viewportPadding
  const maxX = layout.viewportWidth - layout.viewportPadding - previewWidth
  const maxY = layout.viewportHeight - layout.viewportPadding - previewHeight

  return {
    x: clamp(
      side === 'left'
        ? source.x - previewWidth - layout.gap
        : source.x + source.width + layout.gap,
      minX,
      maxX
    ),
    y: clamp(source.y + source.height / 2 - previewHeight / 2, minY, maxY)
  }
}

/** Display-only weapon card with the equipped instance's current stats. */
export function boardWeaponCardPreviewModel(
  definition: WeaponCardDefinition,
  weapon: BoardWeapon
) {
  return {
    card: { ...definition, attack: weapon.attack, durability: weapon.durability },
    silenced: false,
    attackColor: minionAttackColor(weapon.attack, definition.attack),
    healthColor: minionHealthColor(
      weapon.durability,
      weapon.maxDurability,
      definition.durability
    )
  }
}

export function boardWeaponCardPreviewKey(weapon: BoardWeapon): string {
  return [
    'weapon',
    weapon.instanceId,
    weapon.cardId,
    weapon.attack,
    weapon.durability,
    weapon.maxDurability
  ].join(':')
}
