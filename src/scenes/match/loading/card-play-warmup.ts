import {
  Container,
  PerspectiveMesh,
  RenderTexture,
  Sprite,
  type Renderer
} from 'pixi.js'
import type { GameAssets } from '../../../visual-components/assets'
import { CARD_PLAY_AURA_TINT } from '../presentation/card-play-layout'

/** Upload play textures and exercise their sprite/mesh paths before the match. */
export function prewarmCardPlay(renderer: Renderer, assets: GameAssets): void {
  const root = new Container()
  root.label = 'game.card-play-warmup'
  let target: RenderTexture | undefined
  try {
    target = RenderTexture.create({ width: 32, height: 32, resolution: 1 })
    const auras = {
      minion: assets.minionPlayAura,
      legendaryMinion: assets.legendaryMinionPlayAura,
      weapon: assets.weaponPlayAura,
      hero: assets.heroPlayAura,
      heroSpell: assets.heroSpellPlay,
      burst: assets.cardPlayBurst
    }
    const particles = {
      particle1: assets.playSpotlight1,
      particle2: assets.playSpotlight2,
      particle3: assets.playSpotlight3,
      particle4: assets.playSpotlight4,
      particle5: assets.playSpotlight5,
      particle6: assets.playSpotlight6,
      particle7: assets.playSpotlight7,
      particle8: assets.playSpotlight8
    }
    for (const [name, texture] of Object.entries({ ...auras, ...particles })) {
      const sprite = new Sprite(texture)
      sprite.label = `game.card-play-warmup.${name}`
      sprite.width = 24
      sprite.height = 24
      sprite.alpha = 0.5
      sprite.blendMode = 'add'
      sprite.tint = CARD_PLAY_AURA_TINT
      root.addChild(sprite)
    }
    // Landing dust uses untinted, normal-blended sprites rather than additive glows.
    for (const [index, texture] of [
      assets.landingDust1,
      assets.landingDust2,
      assets.landingDust3,
      assets.landingDust4
    ].entries()) {
      const sprite = new Sprite(texture)
      sprite.label = `game.card-play-warmup.dust-${index}`
      sprite.width = sprite.height = 24
      sprite.alpha = 0.5
      sprite.blendMode = 'normal'
      root.addChild(sprite)
    }
    // Spell and hero casts also exercise the perspective mesh path.
    for (const [name, texture] of Object.entries({
      spell: assets.spellPlayAura,
      legendarySpell: assets.legendarySpellPlayAura,
      hero: assets.heroPlayAura,
      burst: assets.cardPlayBurst
    })) {
      const cast = new PerspectiveMesh({
        texture,
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
      cast.label = `game.card-play-warmup.${name}`
      cast.alpha = 0.5
      cast.blendMode = 'add'
      cast.tint = CARD_PLAY_AURA_TINT
      root.addChild(cast)
    }
    renderer.render({ container: root, target, clear: true })
  } finally {
    // The game asset scope owns the source textures; release only our samples.
    root.destroy({ children: true, texture: false, textureSource: false })
    target?.destroy(true)
  }
}
