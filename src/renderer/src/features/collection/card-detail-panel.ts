import { Container, Graphics, Rectangle, Text } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import {
  formatExpansionName,
  type CardDefinition
} from '../../../../game/content/cards'

export interface CardDetailRow {
  readonly label: string
  readonly value: string
}

const COLORS = {
  panel: 0x161d2b,
  panelBorder: 0xb08a4e,
  heading: 0xf1e4c8,
  label: 0xb8a781,
  value: 0xffffff,
  effect: 0xe6d9bd,
  muted: 0x8f9bb0
} as const

const PANEL = {
  x: 150,
  y: 128,
  width: 500,
  height: 824,
  padding: 28,
  headingY: 26,
  rowStartY: 92,
  rowStep: 42,
  effectHeadingGap: 24
} as const

const DETAIL_LABEL_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 18,
  fill: COLORS.label
} as const

const DETAIL_VALUE_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 21,
  fill: COLORS.value,
  wordWrap: true,
  breakWords: true
} as const

const EFFECT_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 22,
  fill: COLORS.effect,
  wordWrap: true,
  breakWords: true,
  lineHeight: 27
} as const

/** Builds the metadata rows shown beside an enlarged card. */
export function cardDetailRows(card: CardDefinition): readonly CardDetailRow[] {
  const rows: CardDetailRow[] = [
    { label: 'Name', value: card.name },
    { label: 'Type', value: card.type },
    { label: 'Mana', value: String(card.cost) },
    { label: 'Class', value: card.cardClass },
    { label: 'Collection', value: formatExpansionName(card.expansionId) },
    { label: 'Rarity', value: card.rarity }
  ]

  if (card.subtype) rows.push({ label: 'Subtype', value: card.subtype })
  if (card.spellSchool) rows.push({ label: 'School', value: card.spellSchool })
  if ((card.type === 'Minion' || card.type === 'Weapon') && card.attack !== null) {
    rows.push({ label: 'Attack', value: String(card.attack) })
  }
  if (card.type === 'Weapon' && card.durability !== null) {
    rows.push({ label: 'Durability', value: String(card.durability) })
  } else if (card.type === 'Hero' && card.armor !== null) {
    rows.push({ label: 'Armor', value: String(card.armor) })
  } else if (card.type === 'Minion' && card.health !== null) {
    rows.push({ label: 'Health', value: String(card.health) })
  }

  return rows
}

/** Creates the reusable feature-owned card metadata panel. */
export function createCardDetailPanel(card: CardDefinition): Container {
  const panel = new Container()
  panel.position.set(PANEL.x, PANEL.y)

  const background = new Graphics()
    .roundRect(0, 0, PANEL.width, PANEL.height, 14)
    .fill({ color: COLORS.panel, alpha: 0.96 })
  background
    .roundRect(0, 0, PANEL.width, PANEL.height, 14)
    .stroke({ color: COLORS.panelBorder, width: 2, alpha: 0.9 })
  background.eventMode = 'none'
  panel.addChild(background)
  panel.eventMode = 'static'
  panel.hitArea = new Rectangle(0, 0, PANEL.width, PANEL.height)
  panel.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation()
  })

  const heading = new Text({
    text: 'CARD DETAILS',
    style: {
      fontFamily: 'Belwe',
      fontSize: 28,
      fill: COLORS.heading
    }
  })
  heading.position.set(PANEL.padding, PANEL.headingY)
  panel.addChild(heading)

  const rows = cardDetailRows(card)
  for (const [index, row] of rows.entries()) {
    const y = PANEL.rowStartY + index * PANEL.rowStep
    const label = new Text({
      text: row.label.toUpperCase(),
      style: DETAIL_LABEL_STYLE
    })
    label.position.set(PANEL.padding, y)
    label.anchor.set(0, 0.5)
    label.eventMode = 'none'
    panel.addChild(label)

    const value = new Text({
      text: row.value,
      style: {
        ...DETAIL_VALUE_STYLE,
        wordWrapWidth: PANEL.width - PANEL.padding * 2 - 140
      }
    })
    value.position.set(PANEL.width - PANEL.padding, y)
    value.anchor.set(1, 0.5)
    value.eventMode = 'none'
    panel.addChild(value)
  }

  const effectY = PANEL.rowStartY + rows.length * PANEL.rowStep + PANEL.effectHeadingGap
  const effectHeading = new Text({
    text: 'EFFECT',
    style: DETAIL_LABEL_STYLE
  })
  effectHeading.position.set(PANEL.padding, effectY)
  effectHeading.eventMode = 'none'
  panel.addChild(effectHeading)

  const effect = new Text({
    text: card.rulesText || 'No effect',
    style: {
      ...EFFECT_STYLE,
      wordWrapWidth: PANEL.width - PANEL.padding * 2
    }
  })
  effect.position.set(PANEL.padding, effectY + 28)
  effect.eventMode = 'none'
  panel.addChild(effect)

  const hint = new Text({
    text: 'Click outside the card or press Escape to close',
    style: {
      fontFamily: 'Franklin Gothic Condensed',
      fontSize: 16,
      fill: COLORS.muted
    }
  })
  hint.position.set(PANEL.padding, PANEL.height - 30)
  hint.anchor.set(0, 0.5)
  hint.eventMode = 'none'
  panel.addChild(hint)

  return panel
}
