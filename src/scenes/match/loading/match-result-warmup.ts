import {
  BlurFilter,
  ColorMatrixFilter,
  Container,
  RenderTexture,
  Sprite,
  type Renderer
} from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import { GAME_BOARD_LAYOUT } from '../game-scene-layout'

/** Draw result assets and both backdrop filter paths before gameplay starts. */
export function prewarmMatchResult(renderer: Renderer, assets: GameAssets): void {
  const root = new Container()
  root.label = 'game.match-result-warmup'
  const blur = new BlurFilter({
    strength: GAME_BOARD_LAYOUT.matchResult.blurStrength,
    quality: 2,
    resolution: 'inherit',
    antialias: 'inherit'
  })
  const grayscale = new ColorMatrixFilter()
  let target: RenderTexture | undefined
  try {
    target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    for (const [name, texture] of Object.entries({
      destroyedLocal: assets.destroyedLocal,
      destroyedRemote: assets.destroyedRemote,
      win: assets.winScreen,
      defeat: assets.defeatScreen
    })) {
      const sample = new Sprite(texture)
      sample.label = `game.match-result-warmup.${name}`
      sample.width = sample.height = 24
      root.addChild(sample)
    }
    root.filters = [blur]
    renderer.render({ container: root, target, clear: true })
    grayscale.desaturate()
    root.filters = [blur, grayscale]
    renderer.render({ container: root, target, clear: true })
  } finally {
    root.filters = []
    root.destroy({ children: true, texture: false, textureSource: false })
    blur.destroy()
    grayscale.destroy()
    target?.destroy(true)
  }
}
