import { Container, Graphics, Text } from 'pixi.js'
import { applyPlacement, type LayoutPlacement } from './layout'

const BADGE_STYLE = {
  fontFamily: 'Franklin Gothic Condensed',
  fontSize: 8,
  fontWeight: 'bold' as const,
  fill: 0xffffff,
  stroke: { color: 0x17120f, width: 2 },
  align: 'center' as const,
  breakWords: true,
  wordWrap: true,
  lineHeight: 8
} as const

/**
 * TEMPORARY BOARD-ABILITY PLACEHOLDER.
 *
 * When an authored ability image is ready, register it in the asset registry,
 * pass its texture into the minion/weapon view, and replace this Graphics/Text
 * group with a Sprite at the corresponding placement. Keeping this isolated
 * makes the temporary UI easy to find and remove without touching game logic.
 */
export function createTemporaryAbilityBadge(
  text: string,
  value: LayoutPlacement,
  label: string
): Container {
  const badge = new Container()
  applyPlacement(badge, value)
  badge.pivot.set(value.size.width * value.anchor.x, value.size.height * value.anchor.y)
  badge.label = label

  const background = new Graphics()
  background
    .roundRect(0, 0, value.size.width, value.size.height, 5)
    .fill({ color: 0x24201d, alpha: 0.94 })
    .stroke({ color: 0xd5b36a, width: 2 })
  background.label = `${label}-background`
  badge.addChild(background)

  const caption = new Text({
    text,
    style: {
      ...BADGE_STYLE,
      wordWrapWidth: value.size.width - 6
    },
    anchor: 0.5
  })
  caption.position.set(value.size.width / 2, value.size.height / 2)
  caption.label = `${label}-text`
  badge.addChild(caption)

  return badge
}
