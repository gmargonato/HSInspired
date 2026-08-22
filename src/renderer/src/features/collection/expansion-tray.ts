import { Container, Rectangle, Sprite, Text, Texture } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { GAME_HEIGHT, GAME_WIDTH } from '../../app/config'
import { EXPANSION_CATALOG } from '../../../../game/content/expansions'
import type { ExpansionId } from '../../../../game/content/cards'
import {
  AnimatedOutline,
  OUTLINE_PROFILES
} from '../../rendering/effects/animated-outline'
import {
  applyAnchoredPlacement,
  placement,
  type LayoutPlacement
} from '../../rendering/layout'
import { Button } from '../../ui/components/Button'
import { Actor } from '../../ui/components/Actor'

export interface ExpansionTrayAssets {
  readonly toggle: Texture
  readonly tray: Texture
  readonly collectionOn: Texture
  readonly collectionOff: Texture
}

export interface ExpansionTrayLayout {
  readonly toggle: LayoutPlacement
  readonly trayOpen: LayoutPlacement
  readonly trayClosed: LayoutPlacement
  readonly buttons: readonly LayoutPlacement[]
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
  private readonly toggleButton: Button
  private readonly outline: AnimatedOutline
  private readonly rowButtons = new Map<ExpansionId, Button>()
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

    this.outline = new AnimatedOutline(outlineTarget, 'blue', OUTLINE_PROFILES.button)
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

    for (const [index, expansion] of EXPANSION_CATALOG.all.entries()) {
      const buttonLayout = this.layout.buttons[index]
      if (!buttonLayout) continue

      const button = new Button(this.assets.collectionOn, {
        sinkPx: 3,
        onClick: () => this.onToggleExpansion(expansion.id),
        onError
      })
      const localCenter = placementCenter(
        toLocalPlacement(buttonLayout, this.layout.trayOpen)
      )
      button.position.set(localCenter.x, localCenter.y)
      button.setBaseY(localCenter.y)
      button.label = `collection.expansion-button:${expansion.id}`

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
      trayRoot.addChild(button)
    }

    this.syncHiddenExpansions()
    return trayRoot
  }

  private toggleTray(): void {
    if (!this.controlsEnabled) return
    this.setOpen(!this.open)
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return

    this.open = open
    this.outline.setEnabled(open)
    this.syncDismissLayer()
    this.killTweensOf(this.trayRoot)
    this.tweenTo(this.trayRoot, {
      y: open ? this.layout.trayOpen.position.y : this.layout.trayClosed.position.y,
      duration: this.slideDuration,
      ease: 'power2.out'
    })
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
