import { describe, expect, it } from 'vitest'
import { CARD_CATALOG, asCardId } from '../../../game-rules/content/cards'
import type { BoardMinion } from '../../../game-rules/match'
import { buildCardRenderTree } from '../../../visual-components/cards/card-layout'
import { MINION_STAT_COLORS } from './minion-stat-presentation'
import {
  boardWeaponCardPreviewModel,
  boardWeaponCardPreviewKey,
  boardMinionCardPreviewModel,
  canShowBoardMinionCardPreview,
  positionBoardMinionCardPreview
} from './board-minion-card-preview'

function previewMinion(overrides: Partial<BoardMinion> = {}): BoardMinion {
  return {
    instanceId: 'minion-1',
    cardId: asCardId('basic_chillwind_yeti'),
    attack: 6,
    health: 2,
    maxHealth: 7,
    baseAttack: 4,
    baseHealth: 5,
    summonedOnTurn: 1,
    lastAttackedOnTurn: null,
    ...overrides
  }
}

describe('board minion card preview', () => {
  it('renders current stats with Hearthstone-style colors', () => {
    const definition = CARD_CATALOG.require(asCardId('basic_chillwind_yeti'))
    if (definition.type !== 'Minion') throw new Error('Expected a minion card.')

    const model = boardMinionCardPreviewModel(definition, previewMinion())

    expect(model.card.attack).toBe(6)
    expect(model.card.health).toBe(2)
    expect(model.attackColor).toBe(MINION_STAT_COLORS.increased)
    expect(model.healthColor).toBe(MINION_STAT_COLORS.damaged)
  })

  it('centers the silence overlay over a silenced card description', () => {
    const definition = CARD_CATALOG.require(asCardId('basic_chillwind_yeti'))
    if (definition.type !== 'Minion') throw new Error('Expected a minion card.')
    const model = boardMinionCardPreviewModel(
      definition,
      previewMinion({ silenced: true })
    )

    const tree = buildCardRenderTree(model.card, { silenced: model.silenced })
    const overlays = tree.root.children.find(
      (node) => node.kind === 'group' && node.id === 'overlays'
    )
    const silence =
      overlays?.kind === 'group'
        ? overlays.children.find(
            (node) => node.kind === 'image' && node.id === 'silence'
          )
        : undefined

    expect(silence?.kind).toBe('image')
    if (silence?.kind !== 'image') throw new Error('Expected a silence overlay.')
    expect(silence.assetKey).toBe('card.overlay.silence')
    expect(silence.transform.position).toEqual({ x: 310, y: 695 })
  })

  it('disables previews during every targeting mode', () => {
    expect(
      canShowBoardMinionCardPreview({
        cardTargeting: false,
        heroPowerTargeting: false,
        combatTargeting: false
      })
    ).toBe(true)

    for (const activeMode of [
      'cardTargeting',
      'heroPowerTargeting',
      'combatTargeting'
    ] as const) {
      expect(
        canShowBoardMinionCardPreview({
          cardTargeting: activeMode === 'cardTargeting',
          heroPowerTargeting: activeMode === 'heroPowerTargeting',
          combatTargeting: activeMode === 'combatTargeting'
        })
      ).toBe(false)
    }
  })

  it('places the card to the right and clamps it inside the viewport', () => {
    const layout = {
      scale: 0.4,
      gap: 18,
      viewportPadding: 20,
      viewportWidth: 1920,
      viewportHeight: 1080
    }

    expect(
      positionBoardMinionCardPreview(
        { x: 900, y: 500, width: 160, height: 180 },
        { width: 620, height: 900 },
        layout
      )
    ).toEqual({ x: 1078, y: 410 })
    expect(
      positionBoardMinionCardPreview(
        { x: 1800, y: 1000, width: 160, height: 180 },
        { width: 620, height: 900 },
        layout
      )
    ).toEqual({ x: 1652, y: 700 })
  })

  it('can place the card to the left while clamping it inside the viewport', () => {
    const layout = {
      scale: 0.4,
      gap: 18,
      viewportPadding: 20,
      viewportWidth: 1920,
      viewportHeight: 1080
    }

    expect(
      positionBoardMinionCardPreview(
        { x: 900, y: 500, width: 160, height: 180 },
        { width: 620, height: 900 },
        layout,
        'left'
      )
    ).toEqual({ x: 634, y: 410 })
    expect(
      positionBoardMinionCardPreview(
        { x: 100, y: 500, width: 160, height: 180 },
        { width: 620, height: 900 },
        layout,
        'left'
      )
    ).toEqual({ x: 20, y: 410 })
  })
})

describe('equipped weapon card preview', () => {
  it('shows live attack and durability without changing the catalog', () => {
    const definition = CARD_CATALOG.require(asCardId('basic_fiery_war_axe'))
    if (definition.type !== 'Weapon') throw new Error('Expected a weapon.')
    const weapon = {
      instanceId: 'weapon-1',
      cardId: definition.id,
      attack: definition.attack + 1,
      durability: 1,
      maxDurability: definition.durability + 1
    }
    const model = boardWeaponCardPreviewModel(definition, weapon)
    expect(model.card.attack).toBe(weapon.attack)
    expect(model.card.durability).toBe(1)
    expect(model.attackColor).toBe(MINION_STAT_COLORS.increased)
    expect(model.healthColor).toBe(MINION_STAT_COLORS.damaged)
    expect(model.card).not.toBe(definition)
    expect(
      boardWeaponCardPreviewModel(definition, {
        ...weapon,
        durability: weapon.maxDurability
      }).healthColor
    ).toBe(MINION_STAT_COLORS.increased)
    for (const changed of [
      { attack: 9 },
      { durability: 2 },
      { maxDurability: 9 },
      { instanceId: 'replacement' }
    ]) {
      expect(boardWeaponCardPreviewKey({ ...weapon, ...changed })).not.toBe(
        boardWeaponCardPreviewKey(weapon)
      )
    }
  })
})
