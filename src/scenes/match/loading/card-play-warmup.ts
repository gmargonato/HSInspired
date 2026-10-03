import {
  Container,
  PerspectiveMesh,
  RenderTexture,
  Sprite,
  type Renderer
} from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'

/** Upload play textures and exercise their sprite/mesh paths before the match. */
export function prewarmCardPlay(renderer: Renderer, assets: GameAssets): void {
  const root = new Container()
  root.label = 'game.card-play-warmup'
  let target: RenderTexture | undefined
  try {
    target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    const sprites = {
      minion: assets.minionPlayAura,
      weapon: assets.weaponPlayAura,
      particle1: assets.playSpotlight1,
      particle2: assets.playSpotlight2,
      particle3: assets.playSpotlight3,
      particle4: assets.playSpotlight4,
      particle5: assets.playSpotlight5,
      particle6: assets.playSpotlight6,
      particle7: assets.playSpotlight7,
      particle8: assets.playSpotlight8
    }
    for (const [name, texture] of Object.entries(sprites)) {
      const sprite = new Sprite(texture)
      sprite.label = `game.card-play-warmup.${name}`
      sprite.width = 24
      sprite.height = 24
      sprite.alpha = 0.5
      sprite.blendMode = 'add'
      root.addChild(sprite)
    }
    // Spells use a perspective mesh rather than the minion/weapon sprite path.
    const spell = new PerspectiveMesh({
      texture: assets.spellPlayAura,
      verticesX: 10,
      verticesY: 10,
      x0: 2,
      y0: 0,
      x1: 22,
      y1: 0,
      x2: 24,
      y2: 24,
      x3: 0,
      y3: 24
    })
    spell.label = 'game.card-play-warmup.spell'
    spell.alpha = 0.5
    spell.blendMode = 'add'
    root.addChild(spell)
    renderer.render({ container: root, target, clear: true })
  } finally {
    // The game asset scope owns the source textures; release only our samples.
    root.destroy({ children: true, texture: false, textureSource: false })
    target?.destroy(true)
  }
}
