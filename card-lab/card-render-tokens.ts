import type { CardTextCurve, CardTextStyle } from './card-render-plan'

/** Semantic depth bands keep ordering readable when a tree is flattened. */
export const CARD_DEPTH = {
  artwork: 0,
  frame: 100,
  taxonomy: 180,
  nameplate: 200,
  rules: 220,
  stats: 300,
  decorations: 400,
  status: 500,
  debug: 10_000
} as const

export const MINION_TYPOGRAPHY = {
  cardName: {
    fontFamily: 'Belwe',
    fontSize: 42,
    fill: 0xffffff,
    align: 'center',
    stroke: { color: 0x17120f, width: 6 },
    wordWrap: true,
    breakWords: true
  },

  rulesText: {
    fontFamily: 'Franklin Gothic Condensed',
    fontSize: 34,
    fill: 0x19130e,
    align: 'center',
    fontWeight: 'normal',
    wordWrap: true,
    lineHeight: 40,
    breakWords: true,
    tagStyles: {
      keyword: { fontWeight: 'bold' }
    }
  },

  tribeLabel: {
    fontFamily: 'Franklin Gothic Condensed',
    fontSize: 22,
    fill: 0x19130e,
    align: 'center',
    fontWeight: 'bold',
    wordWrap: true,
    lineHeight: 23,
    breakWords: true
  },

  statValue: {
    fontFamily: 'Belwe',
    fontSize: 118,
    fill: 0xffffff,
    align: 'center',
    stroke: { color: 0x17120f, width: 8 }
  }
} satisfies Readonly<Record<string, CardTextStyle>>

export const MINION_NAME_CURVE: CardTextCurve = {
  startY: 20,
  control1Y: 52,
  control2Y: -38,
  endY: -18
}
