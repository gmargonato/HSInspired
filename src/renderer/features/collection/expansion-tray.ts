import { Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import type { FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import { EXPANSION_CATALOG } from '../../../game/content/expansions'
import type { ExpansionId } from '../../../game/content/cards'
import { AnimatedOutline } from '../../rendering/effects/animated-outline'
import {
  applyAnchoredPlacement,
  placement,
  type LayoutPlacement
} from '../../rendering/layout'
import { Button } from '../../ui/components/button'
import { Actor } from '../../ui/components/actor'

export interface ExpansionTrayAssets {
  readonly toggle: Texture
  readonly tray: Texture
  readonly collectionOn: Texture
  readonly collectionOff: Texture
  readonly verticalSlider: Texture
}

export interface ExpansionTrayLayout {
  readonly toggle: LayoutPlacement
  readonly trayOpen: LayoutPlacement
  readonly trayClosed: LayoutPlacement
  readonly buttons: readonly LayoutPlacement[]
  readonly viewport: LayoutPlacement
  readonly slider: {
    /** Canvas-space X coordinate shared by the rail and handle. */
    readonly x: number
    /** Canvas-space handle-center range while the tray is open. */
    readonly minY: number
    readonly maxY: number
    readonly handle: LayoutPlacement
  }
}

export interface ExpansionTrayOptions {
  readonly assets: ExpansionTrayAssets
  readonly layout: ExpansionTrayLayout
  readonly slideDuration: number
  readonly isHidden: (expansionId: ExpansionId) => boolean
  readonly onToggleExpansion: (expansionId: ExpansionId) => void
  readonly onError?: (error: unknown) => void
}

/** Bottom-bar toggle and sliding expansion filter tray. */
export class ExpansionTray extends Actor {
  private readonly assets: ExpansionTrayAssets
  private readonly layout: ExpansionTrayLayout
  private readonly slideDuration: number
  private readonly isHidden: (expansionId: ExpansionId) => boolean
  private readonly onToggleExpansion: (expansionId: ExpansionId) => void
  private readonly dismissLayer: Container
  private readonly trayRoot: Container
  private clipMask!: Graphics
  private viewport!: Container
  private content!: Container
  private slider!: Sprite
  private readonly toggleButton: Button
  private readonly outline: AnimatedOutline
  private readonly rowButtons = new Map<ExpansionId, Button>()
  private readonly rowBounds = new Map<ExpansionId, { top: number; height: number }>()
  private viewportTop = 0
  private viewportHeight = 0
  private scrollOffset = 0
  private maxScroll = 0
  private sliderDragging = false
  private sliderDragOffset = 0
  private open = false
  private controlsEnabled = true

  constructor(options: ExpansionTrayOptions) {
    super()
    this.assets = options.assets
    this.layout = options.layout
    this.slideDuration = options.slideDuration
    this.isHidden = options.isHidden
    this.onToggleExpansion = options.onToggleExpansion

    this.dismissLayer = new Container()
    this.dismissLayer.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.dismissLayer.eventMode = 'none'
    this.dismissLayer.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
      this.setOpen(false)
    })
    this.addChild(this.dismissLayer)

    this.trayRoot = this.createTray(options.onError)
    this.addChild(this.trayRoot)

    const outlineTarget = new Sprite(this.assets.toggle)
    applyAnchoredPlacement(outlineTarget, this.layout.toggle)
    outlineTarget.eventMode = 'none'
    outlineTarget.label = 'collection.expansion-toggle-outline'
    this.addChild(outlineTarget)

    this.toggleButton = new Button(this.assets.toggle, {
      onClick: () => this.toggleTray(),
      onError: options.onError
    })
    const toggleCenter = placementCenter(this.layout.toggle)
    this.toggleButton.position.set(toggleCenter.x, toggleCenter.y)
    this.toggleButton.setBaseY(toggleCenter.y)
    this.toggleButton.label = 'collection.expansion-toggle'
    this.addChild(this.toggleButton)

    this.outline = new AnimatedOutline(outlineTarget, {
      palette: 'blue',
      preset: 'expansion-toggle'
    })
    this.outline.setEnabled(false)
    this.addChild(this.outline)
    this.on('globalpointerdown', this.handleGlobalPointerDown)
  }

  setEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled
    this.toggleButton.setEnabled(enabled)
    for (const button of this.rowButtons.values()) {
      button.setEnabled(enabled)
    }
    this.syncDismissLayer()
    this.syncScrollInteraction()
  }

  syncHiddenExpansions(): void {
    for (const [expansionId, button] of this.rowButtons) {
      button.sprite.texture = this.isHidden(expansionId)
        ? this.assets.collectionOff
        : this.assets.collectionOn
    }
  }

  override dispose(): void {
    this.off('globalpointerdown', this.handleGlobalPointerDown)
    this.viewport.off('wheel', this.handleWheel)
    this.slider.off('pointerdown', this.handleSliderDown)
    this.slider.off('globalpointermove', this.handleSliderMove)
    this.slider.off('pointerup', this.stopSliderDrag)
    this.slider.off('pointerupoutside', this.stopSliderDrag)
    this.slider.off('pointercancel', this.stopSliderDrag)
    this.stopSliderDrag()
    this.outline.dispose()
    super.dispose()
  }

  private createTray(onError?: (error: unknown) => void): Container {
    const trayRoot = new Container()
    trayRoot.position.set(
      this.layout.trayClosed.position.x,
      this.layout.trayClosed.position.y
    )
    trayRoot.hitArea = new Rectangle(
      0,
      0,
      this.layout.trayOpen.size.width,
      this.layout.trayOpen.size.height
    )
    trayRoot.eventMode = 'static'
    trayRoot.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation()
    })

    const tray = new Sprite(this.assets.tray)
    applyAnchoredPlacement(
      tray,
      placement({ x: 0, y: 0 }, this.layout.trayOpen.size, {
        anchor: this.layout.trayOpen.anchor
      })
    )
    tray.eventMode = 'none'
    tray.label = 'collection.expansion-tray'
    trayRoot.addChild(tray)

    const viewportLayout = toLocalPlacement(this.layout.viewport, this.layout.trayOpen)
    this.viewportTop = viewportLayout.position.y
    this.viewportHeight = viewportLayout.size.height

    this.clipMask = new Graphics()
      .rect(
        viewportLayout.position.x,
        viewportLayout.position.y,
        viewportLayout.size.width,
        viewportLayout.size.height
      )
      .fill(0xffffff)
    this.clipMask.label = 'collection.expansion-mask'
    this.clipMask.eventMode = 'none'

    this.viewport = new Container()
    this.viewport.label = 'collection.expansion-viewport'
    this.viewport.hitArea = new Rectangle(
      viewportLayout.position.x,
      viewportLayout.position.y,
      viewportLayout.size.width,
      viewportLayout.size.height
    )
    this.viewport.eventMode = 'none'
    this.viewport.mask = this.clipMask
    this.viewport.on('wheel', this.handleWheel)

    this.content = new Container()
    this.content.label = 'collection.expansion-content'
    this.viewport.addChild(this.content)
    trayRoot.addChild(this.clipMask, this.viewport)

    this.slider = new Sprite(this.assets.verticalSlider)
    applyAnchoredPlacement(
      this.slider,
      toLocalPlacement(this.layout.slider.handle, this.layout.trayOpen)
    )
    this.slider.label = 'collection.expansion-slider'
    this.slider.eventMode = 'none'
    this.slider.cursor = 'pointer'
    this.slider.on('pointerdown', this.handleSliderDown)
    this.slider.on('globalpointermove', this.handleSliderMove)
    this.slider.on('pointerup', this.stopSliderDrag)
    this.slider.on('pointerupoutside', this.stopSliderDrag)
    this.slider.on('pointercancel', this.stopSliderDrag)
    trayRoot.addChild(this.slider)

    for (const [index, expansion] of EXPANSION_CATALOG.all.entries()) {
      const buttonLayout = this.layout.buttons[index]
      if (!buttonLayout) continue

      const button = new Button(this.assets.collectionOn, {
        sinkPx: 3,
        onClick: () => this.onToggleExpansion(expansion.id),
        onError
      })
      const localButtonLayout = toLocalPlacement(buttonLayout, this.layout.trayOpen)
      const localCenter = placementCenter(localButtonLayout)
      button.position.set(localCenter.x, localCenter.y)
      button.setBaseY(localCenter.y)
      button.label = `collection.expansion-button:${expansion.id}`
      this.rowBounds.set(expansion.id, {
        top: localButtonLayout.position.y,
        height: localButtonLayout.size.height
      })

      const label = new Text({
        text: expansion.displayName,
        style: {
          fontFamily: 'Belwe',
          fontSize: 16,
          fill: 0x2b2118,
          align: 'left',
          wordWrap: true,
          wordWrapWidth: 210
        }
      })
      label.anchor.set(0, 0.5)
      label.position.set(-130, 0)
      label.eventMode = 'none'
      button.addChild(label)

      this.rowButtons.set(expansion.id, button)
      this.content.addChild(button)
    }

    this.maxScroll = this.calculateMaxScroll()
    this.setScroll(this.scrollOffset)
    this.syncHiddenExpansions()
    this.syncScrollInteraction()
    return trayRoot
  }

  private toggleTray(): void {
    if (!this.controlsEnabled) return
    this.setOpen(!this.open)
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return

    this.open = open
    if (!open) this.stopSliderDrag()
    this.outline.setEnabled(open)
    this.syncDismissLayer()
    this.updateSliderPosition()
    this.syncScrollInteraction()
    this.killTweensOf(this.trayRoot)
    this.tweenTo(this.trayRoot, {
      y: open ? this.layout.trayOpen.position.y : this.layout.trayClosed.position.y,
      duration: this.slideDuration,
      ease: 'power2.out'
    })
  }

  private calculateMaxScroll(): number {
    const viewportBottom = this.viewportTop + this.viewportHeight
    let contentBottom = viewportBottom
    for (const bounds of this.rowBounds.values()) {
      contentBottom = Math.max(contentBottom, bounds.top + bounds.height)
    }
    return Math.max(0, contentBottom - viewportBottom)
  }

  private setScroll(offset: number): void {
    this.scrollOffset = Math.max(-this.maxScroll, Math.min(0, offset))
    this.content.y = this.scrollOffset

    const viewportBottom = this.viewportTop + this.viewportHeight
    for (const [expansionId, bounds] of this.rowBounds) {
      const button = this.rowButtons.get(expansionId)
      if (!button) continue
      const top = bounds.top + this.scrollOffset
      const bottom = top + bounds.height
      button.visible = bottom > this.viewportTop && top < viewportBottom
    }

    this.updateSliderPosition()
  }

  private updateSliderPosition(): void {
    if (!this.slider) return

    if (this.maxScroll === 0) {
      this.slider.visible = false
      return
    }

    const ratio = -this.scrollOffset / this.maxScroll
    const minY = this.layout.slider.minY - this.layout.trayOpen.position.y
    const maxY = this.layout.slider.maxY - this.layout.trayOpen.position.y
    this.slider.position.set(
      this.layout.slider.x - this.layout.trayOpen.position.x,
      minY + ratio * (maxY - minY)
    )
    this.slider.visible = this.open
  }

  private syncScrollInteraction(): void {
    if (!this.viewport || !this.slider) return

    const viewportEnabled = this.open && this.controlsEnabled
    const sliderEnabled = viewportEnabled && this.maxScroll > 0
    this.viewport.eventMode = viewportEnabled ? 'static' : 'none'
    this.slider.eventMode = sliderEnabled ? 'static' : 'none'
    this.slider.cursor = sliderEnabled ? 'pointer' : 'default'
    this.slider.visible = this.open && this.maxScroll > 0

    if (!sliderEnabled) this.stopSliderDrag()
  }

  private readonly handleWheel = (event: FederatedWheelEvent): void => {
    if (!this.open || !this.controlsEnabled || this.maxScroll === 0) return

    this.setScroll(this.scrollOffset - event.deltaY)
    event.stopPropagation()
  }

  private readonly handleSliderDown = (event: FederatedPointerEvent): void => {
    if (
      event.button !== 0 ||
      !this.open ||
      !this.controlsEnabled ||
      this.maxScroll === 0
    ) {
      return
    }

    const local = this.trayRoot.toLocal(event.global)
    this.sliderDragging = true
    this.sliderDragOffset = local.y - this.slider.y
    event.stopPropagation()
  }

  private readonly handleSliderMove = (event: FederatedPointerEvent): void => {
    if (!this.sliderDragging || this.maxScroll === 0) return

    const local = this.trayRoot.toLocal(event.global)
    const minY = this.layout.slider.minY - this.layout.trayOpen.position.y
    const maxY = this.layout.slider.maxY - this.layout.trayOpen.position.y
    const sliderY = Math.max(minY, Math.min(maxY, local.y - this.sliderDragOffset))
    const trackRange = maxY - minY
    const scrollRatio = trackRange === 0 ? 0 : (sliderY - minY) / trackRange
    this.setScroll(-scrollRatio * this.maxScroll)
    event.stopPropagation()
  }

  private readonly stopSliderDrag = (): void => {
    this.sliderDragging = false
    this.sliderDragOffset = 0
  }

  private syncDismissLayer(): void {
    this.dismissLayer.eventMode = this.open && this.controlsEnabled ? 'static' : 'none'
  }

  private readonly handleGlobalPointerDown = (event: FederatedPointerEvent): void => {
    if (!this.open || !this.controlsEnabled) return
    if (this.containsEventTarget(event.target)) return
    this.setOpen(false)
  }

  private containsEventTarget(target: EventTarget | null): boolean {
    let current: object | null = target
    while (current instanceof Container) {
      if (
        current === this.trayRoot ||
        current === this.toggleButton ||
        current === this.dismissLayer
      ) {
        return true
      }
      current = current.parent
    }
    return false
  }
}

function toLocalPlacement(
  value: LayoutPlacement,
  parent: LayoutPlacement
): LayoutPlacement {
  return placement(
    {
      x: value.position.x - parent.position.x,
      y: value.position.y - parent.position.y
    },
    value.size,
    { anchor: value.anchor }
  )
}

function placementCenter(value: LayoutPlacement): { x: number; y: number } {
  const scaleX = value.scale?.x ?? 1
  const scaleY = value.scale?.y ?? 1
  return {
    x: value.position.x + (0.5 - value.anchor.x) * value.size.width * scaleX,
    y: value.position.y + (0.5 - value.anchor.y) * value.size.height * scaleY
  }
}
