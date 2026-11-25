import { Container, Sprite, Text, type FederatedPointerEvent } from 'pixi.js'
import type { PreferencesApi } from '../../desktop/contracts/ipc/preferences'
import type { MenuSettingsAssets, SharedUIAssets } from '../../visual-components/assets'
import {
  CURSOR_SCALE_LIMITS,
  type CursorManager
} from '../../visual-components/controls/cursor'
import {
  applyAnchoredPlacement,
  type LayoutPlacement
} from '../../visual-components/layout'
import { SETTINGS_LAYOUT } from './settings-layout'

interface CursorSizeLayout {
  readonly cursorSizeTitle: LayoutPlacement
  readonly cursorSlider: LayoutPlacement
  readonly cursorSliderHandle: LayoutPlacement
  readonly cursorSliderTravel: { readonly minX: number; readonly maxX: number }
}

/** Live cursor preview with persistence at the end of each gesture. */
export class CursorSizeSlider extends Container {
  private readonly handle: Sprite
  private pointerId: number | null = null
  private grabOffset = 0
  private dirty = false
  private saveQueue: Promise<void> = Promise.resolve()

  constructor(
    assets: Pick<MenuSettingsAssets, 'cursorSlider'> &
      Pick<SharedUIAssets, 'horizontalSlider'>,
    private readonly cursorManager: CursorManager,
    private readonly api: PreferencesApi,
    private readonly onInteract: () => void,
    private readonly onError: (error: unknown) => void,
    private readonly layout: CursorSizeLayout = SETTINGS_LAYOUT
  ) {
    super()
    this.label = 'settings.cursor-size-slider'
    const title = new Text({
      text: 'Cursor Size',
      style: { fontFamily: 'Franklin Gothic Condensed', fontSize: 36, fill: 0xf5e3b6 }
    })
    title.label = 'settings.cursor-size-title'
    title.eventMode = 'none'
    applyAnchoredPlacement(title, this.layout.cursorSizeTitle)
    const track = new Sprite(assets.cursorSlider)
    track.label = 'settings.cursor-size-track'
    applyAnchoredPlacement(track, this.layout.cursorSlider)
    track.eventMode = 'static'
    this.handle = new Sprite(assets.horizontalSlider)
    this.handle.label = 'settings.cursor-size-handle'
    applyAnchoredPlacement(this.handle, this.layout.cursorSliderHandle)
    this.handle.eventMode = 'static'
    this.addChild(title, track, this.handle)
    this.eventMode = 'static'
    track.on('pointerdown', (event: FederatedPointerEvent) =>
      this.startDrag(event, false)
    )
    this.handle.on('pointerdown', (event: FederatedPointerEvent) =>
      this.startDrag(event, true)
    )
    this.on('globalpointermove', this.move)
    this.syncHandle()
  }

  dispose(): void {
    this.finishDrag()
    this.off('globalpointermove', this.move)
  }

  private startDrag(event: FederatedPointerEvent, onHandle: boolean): void {
    if (event.button !== 0 || this.pointerId !== null) return
    event.stopPropagation()
    this.onInteract()
    this.pointerId = event.pointerId
    const x = this.toLocal(event.global).x
    this.grabOffset = onHandle ? x - this.handle.x : 0
    this.setFromX(x)
    window.addEventListener('pointerup', this.release)
    window.addEventListener('pointercancel', this.release)
    window.addEventListener('blur', this.finishDrag)
  }

  private readonly move = (event: FederatedPointerEvent): void => {
    if (event.pointerId !== this.pointerId) return
    this.setFromX(this.toLocal(event.global).x)
  }

  private readonly release = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.finishDrag()
  }

  private readonly finishDrag = (): void => {
    this.pointerId = null
    window.removeEventListener('pointerup', this.release)
    window.removeEventListener('pointercancel', this.release)
    window.removeEventListener('blur', this.finishDrag)
    if (!this.dirty) return
    this.dirty = false
    const cursorScale = this.cursorManager.getScale()
    this.saveQueue = this.saveQueue
      .then(async () => {
        await this.api.set({ cursorScale })
      })
      .catch(this.onError)
  }

  private setFromX(x: number): void {
    const { minX, maxX } = this.layout.cursorSliderTravel
    const { min, max } = CURSOR_SCALE_LIMITS
    const fraction = Math.max(
      0,
      Math.min(1, (x - this.grabOffset - minX) / (maxX - minX))
    )
    const scale = min + fraction * (max - min)
    if (scale !== this.cursorManager.getScale()) this.dirty = true
    this.cursorManager.setScale(scale)
    this.syncHandle()
  }

  private syncHandle(): void {
    const { minX, maxX } = this.layout.cursorSliderTravel
    const { min, max } = CURSOR_SCALE_LIMITS
    this.handle.x =
      minX + ((this.cursorManager.getScale() - min) / (max - min)) * (maxX - minX)
  }
}
