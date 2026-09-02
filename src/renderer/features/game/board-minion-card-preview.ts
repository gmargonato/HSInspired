import type { MinionCardDefinition } from '../../../game/content/cards'
import type { BoardMinion } from '../../../game/match'
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
    minion.silenced === true ? 1 : 0
  ].join(':')
}

/** Positions a scaled card to the minion's right and keeps it on the design canvas. */
export function positionBoardMinionCardPreview(
  source: BoardMinionCardPreviewBounds,
  cardSize: { readonly width: number; readonly height: number },
  layout: BoardMinionCardPreviewLayout
): { readonly x: number; readonly y: number } {
  const previewWidth = cardSize.width * layout.scale
  const previewHeight = cardSize.height * layout.scale
  const minX = layout.viewportPadding
  const minY = layout.viewportPadding
  const maxX = layout.viewportWidth - layout.viewportPadding - previewWidth
  const maxY = layout.viewportHeight - layout.viewportPadding - previewHeight

  return {
    x: clamp(source.x + source.width + layout.gap, minX, maxX),
    y: clamp(source.y + source.height / 2 - previewHeight / 2, minY, maxY)
  }
}
