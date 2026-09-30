import { Container, Sprite, Texture } from 'pixi.js'
import type { MainMenuAssets } from '../../visual-components/assets'
import { MAIN_MENU_LAYOUT } from '../../scenes/main-menu/main-menu-layout'
import { GodRaysDust } from '../../visual-components/effects/god-rays-dust'
import type { GodRaysDustTuning } from '../../desktop/contracts/ipc/god-rays-dust-tuning'
import {
  applyAnchoredPlacement,
  placement,
  CENTER
} from '../../visual-components/layout'
import {
  createGodRaysFilter,
  type GodRaysEffect,
  type GodRaysTuning
} from '../../visual-components/effects/god-rays-filter'

/** Static closed-menu artwork in production draw order; only the light animates. */
export class GodRaysLab extends Container {
  private readonly rays: GodRaysEffect
  private readonly overlay: Sprite
  private readonly dust: GodRaysDust

  constructor(
    assets: MainMenuAssets,
    tuning: GodRaysTuning,
    dustTuning: GodRaysDustTuning
  ) {
    super()
    this.label = 'outline-lab.god-rays.main-menu'
    this.eventMode = 'none'
    this.interactiveChildren = false
    const { screen, chest, menuButtons } = MAIN_MENU_LAYOUT
    const add = (
      parent: Container,
      texture: Texture,
      label: string,
      value: ReturnType<typeof placement>
    ): Sprite => {
      const sprite = new Sprite(texture)
      sprite.label = 'outline-lab.god-rays.' + label
      sprite.eventMode = 'none'
      applyAnchoredPlacement(sprite, value)
      parent.addChild(sprite)
      return sprite
    }
    const table = add(this, assets.table, 'table', screen.table)
    table.width = screen.table.size.width
    table.height = screen.table.size.height
    const artwork = new Container()
    artwork.label = 'outline-lab.god-rays.chest'
    artwork.position.set(screen.screenCenter.x, screen.screenCenter.y)
    this.addChild(artwork)
    add(artwork, assets.box, 'box', chest.box)
    // The closed hinged meshes are flat rectangles at these same source positions.
    add(
      artwork,
      assets.leftLid,
      'left-lid',
      placement(
        {
          x: chest.leftLidInnerEdge.x - assets.leftLid.width,
          y: chest.leftLidInnerEdge.y - assets.leftLid.height / 2
        },
        { width: assets.leftLid.width, height: assets.leftLid.height }
      )
    )
    add(
      artwork,
      assets.rightLid,
      'right-lid',
      placement(
        {
          x: chest.rightLidInnerEdge.x,
          y: chest.rightLidInnerEdge.y - assets.rightLid.height / 2
        },
        { width: assets.rightLid.width, height: assets.rightLid.height }
      )
    )
    add(
      artwork,
      assets.centerPartMenu,
      'center-menu',
      placement(
        chest.centerPartOffset,
        { width: assets.centerPartMenu.width, height: assets.centerPartMenu.height },
        { anchor: CENTER }
      )
    )
    add(artwork, assets.buttonPlay, 'play', menuButtons.play)
    add(artwork, assets.buttonCollection, 'collection', menuButtons.collection)
    add(artwork, assets.buttonArena, 'arena', menuButtons.arena)
    add(artwork, assets.buttonTavern, 'tavern', menuButtons.tavern)
    this.overlay = add(this, Texture.WHITE, 'rays', screen.godRays)
    this.overlay.width = screen.godRays.size.width
    this.overlay.height = screen.godRays.size.height
    this.rays = createGodRaysFilter(tuning)
    this.overlay.filters = [this.rays.filter]
    this.dust = new GodRaysDust(
      [assets.dustRound, assets.dustTriangle],
      this.rays,
      dustTuning
    )
    this.dust.label = 'outline-lab.god-rays.dust'
    this.addChild(this.dust)
  }

  setTuning(tuning: GodRaysTuning): void {
    this.rays.setTuning(tuning)
  }

  update(deltaMS: number): void {
    this.rays.update(deltaMS)
    this.dust.update(deltaMS)
  }

  setDustTuning(tuning: GodRaysDustTuning): void {
    this.dust.setTuning(tuning)
  }

  override destroy(options?: Parameters<Container['destroy']>[0]): void {
    if (this.destroyed) return
    this.overlay.filters = null
    this.dust.destroy({ children: true })
    this.rays.destroy()
    super.destroy(options)
  }
}
