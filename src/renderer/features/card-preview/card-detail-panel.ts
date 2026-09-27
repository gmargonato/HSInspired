import { Container, Rectangle, Sprite, Text, type Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { formatExpansionName, type CardDefinition } from '../../../game/content/cards'
import { applyPlacement } from '../../rendering/layout'
import { CARD_PREVIEW_LAYOUT } from './card-preview-layout'

export interface CardDetailRow {
  readonly label: string
  readonly value: string
}

const DETAIL_TEXT_COLOR = 0x1b130d

const PANEL = {
  width: 447,
  height: 678,
  contentCenterX: 223.5,
  contentWidth: 372,
  descriptionWidth: 320,
  headingY: 52,
  rowStartY: 91,
  rowGap: 12,
  effectHeadingGap: 14,
  plaqueY: 438, // collection
  rarityGemY: 520,
  rarityGemHeight: 58,
  rarityLabelGap: 4,
  typeY: 555 //spell/weapon/minion
} as const

const DETAIL_HEADING_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 24,
  fill: DETAIL_TEXT_COLOR,
  align: 'center'
} as const

const DETAIL_ROW_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 15,
  fill: DETAIL_TEXT_COLOR,
  align: 'center',
  wordWrap: true,
  breakWords: true,
  wordWrapWidth: PANEL.contentWidth,
  lineHeight: 18
} as const

const EFFECT_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 16,
  fill: DETAIL_TEXT_COLOR,
  align: 'center',
  wordWrap: true,
  breakWords: true,
  wordWrapWidth: PANEL.descriptionWidth,
  lineHeight: 19
} as const

const PLAQUE_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 15,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
  align: 'center'
} as const

const TYPE_STYLE = {
  fontFamily: 'Belwe',
  fontSize: 20,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 4 },
  align: 'center'
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

  const tribes = [
    ...new Set(
      [...(card.tribes ?? []), card.subtype].filter((tribe): tribe is string =>
        Boolean(tribe)
      )
    )
  ]
  if (tribes.length > 0)
    rows.push({
      label: tribes.length === 1 ? 'Tribe' : 'Tribes',
      value: tribes.join(', ')
    })
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
export function createCardDetailPanel(
  card: CardDefinition,
  detailContainerTexture: Texture,
  rarityGemTexture?: Texture
): Container {
  const panel = new Container()
  applyPlacement(panel, CARD_PREVIEW_LAYOUT.detailsPanel)

  const background = new Sprite(detailContainerTexture)
  background.eventMode = 'none'
  panel.addChild(background)
  panel.eventMode = 'static'
  panel.hitArea = new Rectangle(0, 0, PANEL.width, PANEL.height)
  panel.on('pointertap', (event: FederatedPointerEvent) => {
    event.stopPropagation()
  })

  const heading = new Text({
    text: 'CARD DETAILS',
    style: DETAIL_HEADING_STYLE
  })
  heading.anchor.set(0.5, 0)
  heading.position.set(PANEL.contentCenterX, PANEL.headingY)
  panel.addChild(heading)

  const rows = cardDetailRows(card).filter(
    (row) =>
      row.label !== 'Type' &&
      row.label !== 'Class' &&
      row.label !== 'Collection' &&
      row.label !== 'Rarity'
  )
  let rowY = PANEL.rowStartY
  for (const row of rows) {
    const detail = new Text({
      text: `${row.label.toUpperCase()}\n${row.value}`,
      style: DETAIL_ROW_STYLE
    })
    detail.anchor.set(0.5, 0)
    detail.position.set(PANEL.contentCenterX, rowY)
    detail.eventMode = 'none'
    panel.addChild(detail)
    rowY += detail.height + PANEL.rowGap
  }

  const effectY = rowY + PANEL.effectHeadingGap
  const effectHeading = new Text({
    text: 'EFFECT',
    style: {
      ...DETAIL_HEADING_STYLE,
      fontSize: 18
    }
  })
  effectHeading.anchor.set(0.5, 0)
  effectHeading.position.set(PANEL.contentCenterX, effectY)
  effectHeading.eventMode = 'none'
  panel.addChild(effectHeading)

  const effect = new Text({
    text: card.rulesText || 'No effect',
    style: EFFECT_STYLE
  })
  effect.anchor.set(0.5, 0)
  effect.position.set(PANEL.contentCenterX, effectY + effectHeading.height + 5)
  effect.eventMode = 'none'
  panel.addChild(effect)

  const collection = new Text({
    text: formatExpansionName(card.expansionId),
    style: PLAQUE_STYLE
  })
  collection.position.set(PANEL.contentCenterX, PANEL.plaqueY)
  collection.anchor.set(0.5)
  collection.eventMode = 'none'
  panel.addChild(collection)

  if (rarityGemTexture) {
    const rarityLabel = new Text({
      text: card.rarity,
      style: PLAQUE_STYLE
    })
    rarityLabel.anchor.set(0.5, 1)
    rarityLabel.position.set(
      PANEL.contentCenterX,
      PANEL.rarityGemY - PANEL.rarityGemHeight / 2 - PANEL.rarityLabelGap
    )
    rarityLabel.eventMode = 'none'
    panel.addChild(rarityLabel)

    const rarityGem = new Sprite(rarityGemTexture)
    rarityGem.anchor.set(0.5)
    rarityGem.position.set(PANEL.contentCenterX, PANEL.rarityGemY)
    rarityGem.width = 42
    rarityGem.height = PANEL.rarityGemHeight
    rarityGem.eventMode = 'none'
    panel.addChild(rarityGem)
  }

  const type = new Text({
    text: card.type,
    style: TYPE_STYLE
  })
  type.position.set(PANEL.contentCenterX, PANEL.typeY)
  type.anchor.set(0.5)
  type.eventMode = 'none'
  panel.addChild(type)

  return panel
}
