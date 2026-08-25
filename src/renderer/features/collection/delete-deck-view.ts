import { Container, Rectangle, Sprite } from 'pixi.js'
import type { FederatedPointerEvent } from 'pixi.js'
import { Button } from '../../ui/components/button'
import { ASSET_BUNDLE_IDS, type CollectionAssets } from '../../ui/asset-registry'
import { GAME_HEIGHT, GAME_WIDTH } from '../../rendering/layout'
import { AnimationScope } from '../../animation/animations'
import { AssetScope } from '../../ui/asset-registry/asset-scope'
import { applyAnchoredPlacement, applyPlacement } from '../../rendering/layout'
import { DELETE_DECK_LAYOUT } from './delete-deck-layout'

/**
 * Nested deck-deletion confirmation overlay presented by CollectionScene.
 *
 * Right-clicking a deck frame in the collection opens this modal; confirm
 * deletes the deck and cancel (or Escape) dismisses it. The full-viewport
 * blocking layer keeps the collection underneath unreachable while open.
 */
export class DeleteDeckView extends Container {
  private readonly animationScope = new AnimationScope()
  private readonly assetScope = new AssetScope()

  private blocker!: Container
  private content!: Container
  private containerSprite!: Sprite
  private confirmButton!: Button
  private cancelButton!: Button
  private openState = false
  private closing = false
  private mounted = false
  private disposed = false
  private pendingResolve: ((confirmed: boolean) => void) | null = null

  get isOpen(): boolean {
    return this.openState
  }

  async mount(): Promise<void> {
    if (this.mounted) return
    const assets = await this.assetScope.acquire<CollectionAssets>(
      ASSET_BUNDLE_IDS.collection
    )
    this.createDialog(assets)
    this.visible = false
    this.mounted = true
  }

  /**
   * Shows the confirmation overlay. Resolves with `true` when the player
   * confirms the deletion and `false` when they cancel.
   */
  confirmDeletion(): Promise<boolean> {
    if (!this.mounted || this.disposed || this.openState || this.closing) {
      return Promise.resolve(false)
    }

    this.openState = true
    this.blocker.visible = true
    this.visible = true
    this.confirmButton.setEnabled(true)
    this.cancelButton.setEnabled(true)
    window.addEventListener('keydown', this.handleKeyDown)

    return new Promise<boolean>((resolve) => {
      this.pendingResolve = resolve
    })
  }

  private createDialog(assets: CollectionAssets): void {
    this.blocker = new Container()
    this.blocker.hitArea = new Rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT)
    this.blocker.eventMode = 'static'
    this.blocker.on('pointertap', (event: FederatedPointerEvent) =>
      event.stopPropagation()
    )
    this.blocker.visible = false
    this.addChild(this.blocker)

    this.content = new Container()
    this.blocker.addChild(this.content)

    this.containerSprite = new Sprite(assets.deleteDeckContainer)
    applyAnchoredPlacement(this.containerSprite, DELETE_DECK_LAYOUT.container)
    this.containerSprite.label = 'collection.delete-deck.container'
    this.containerSprite.eventMode = 'static'
    this.containerSprite.on('pointertap', this.handleContainerTap)
    this.content.addChild(this.containerSprite)

    this.confirmButton = new Button(assets.deleteDeckConfirm, {
      onClick: () => this.finish(true)
    })
    applyPlacement(this.confirmButton, DELETE_DECK_LAYOUT.confirmButton)
    this.confirmButton.setBaseY(DELETE_DECK_LAYOUT.confirmButton.position.y)
    this.confirmButton.label = 'collection.delete-deck.confirm'
    this.confirmButton.setEnabled(false)
    this.content.addChild(this.confirmButton)

    this.cancelButton = new Button(assets.deleteDeckCancel, {
      onClick: () => this.finish(false)
    })
    applyPlacement(this.cancelButton, DELETE_DECK_LAYOUT.cancelButton)
    this.cancelButton.setBaseY(DELETE_DECK_LAYOUT.cancelButton.position.y)
    this.cancelButton.label = 'collection.delete-deck.cancel'
    this.cancelButton.setEnabled(false)
    this.content.addChild(this.cancelButton)
  }

  private readonly handleContainerTap = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    this.finish(false)
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    this.finish(false)
  }

  private finish(confirmed: boolean): void {
    if (!this.openState || this.closing || !this.pendingResolve) return

    this.closing = true
    this.confirmButton.setEnabled(false)
    this.cancelButton.setEnabled(false)
    window.removeEventListener('keydown', this.handleKeyDown)

    this.openState = false
    this.closing = false
    this.blocker.visible = false
    this.visible = false
    this.pendingResolve?.(confirmed)
    this.pendingResolve = null
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.openState = false
    this.closing = false
    window.removeEventListener('keydown', this.handleKeyDown)
    this.animationScope.kill(this.content)
    this.pendingResolve?.(false)
    this.pendingResolve = null
    await this.assetScope.releaseAll()
  }
}
