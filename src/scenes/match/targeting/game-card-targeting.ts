import { Container } from 'pixi.js'
import type {
  PlayCardInput,
  CardPlayTargetRef,
  PlayerId
} from '../../../game-rules/match'
import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { HeroView } from '../board/hero-view'
import { gsap } from '../../../visual-components/animation/animations'
import type { GameAssets } from '../../../visual-components/assets'
import type { CursorManager } from '../../../visual-components/controls/cursor'
import type { RendererLogger } from '../../../application/contracts/logger'
import type { AttackLine } from './attack-line'
import type { CardSelectionOverlay } from '../presentation/card-selection-overlay'
import type { GameHandView } from '../hand/game-hand-view'
import type { GameCardSlot } from '../hand/game-card-slot'
import type { HandEntry } from '../hand/game-hand-entry'
import type { HandPointer } from '../hand/hand-layout'
import type { CombatView } from '../combat/game-combat-presentation'
import { DEFAULT_HAND_DRAG } from '../hand/hand-drag'
import {
  pendingCardInputStage,
  resolveHandCardArrowOrigin,
  type HandCardTargetingOrigin
} from '../hand/hand-play-gesture'
import { OPENING_TIMING } from '../presentation/game-presentation-timing'
import type {
  CardPlayTargetingState,
  PendingMinionTargetPreview,
  MinionPreviewPresentation
} from './game-card-targeting-types'

function cardDefinition(card: HandEntry['card']) {
  return CARD_CATALOG.require(card.cardId)
}

interface CardTargetingContext {
  localParticipantId(): PlayerId
  getPlayInput(cardInstanceId: string, choice: number): PlayCardInput | null | undefined
  previewPosition(position: number): { readonly x: number; readonly y: number }
  presentMinionPreview(
    preview: PendingMinionTargetPreview
  ): Promise<MinionPreviewPresentation | null>
  showBoardPreview(position: number, owner: string): void
  clearBoardPreview(position: number, owner: string): void
  releaseSummonSlot(slot: GameCardSlot): void
  syncAttackability(): void
  syncControls(): void
  syncHud(): void
  hideBoardCardPreview(): void
  deselectAttacker(): void
  cancelHeroPowerTargeting(): void
  cancelCardGesture(): void
  submitPendingCard(): void
  findTargetAt(x: number, y: number): CombatView | null
  hasSession(): boolean
  isDisposed(): boolean
}

/** Owns pending target/choice collection and temporary minion presentation.
 * The board submits the completed command and adopts accepted preview views.
 */
export class GameCardTargeting {
  readonly cardChoiceLayer = new Container()
  private cardTargeting: CardPlayTargetingState | null = null
  private lastTargetingPointer: HandPointer | null = null
  private disposed = false

  constructor(
    private readonly assets: GameAssets,
    private readonly hand: GameHandView,
    private readonly attackLine: AttackLine,
    private readonly cardSelectionOverlay: CardSelectionOverlay,
    private readonly logger: RendererLogger,
    private readonly context: CardTargetingContext,
    private readonly cursor?: CursorManager | null
  ) {
    this.cardChoiceLayer.label = 'game.card-choice'
    this.cardChoiceLayer.eventMode = 'passive'
    this.cardChoiceLayer.visible = false
  }

  get current(): Readonly<CardPlayTargetingState> | null {
    return this.cardTargeting
  }
  get pointer(): HandPointer | null {
    return this.lastTargetingPointer
  }
  updatePointer(pointer: HandPointer): void {
    this.lastTargetingPointer = pointer
  }

  /** Transfers an accepted preview to the board without cancelling its presentation. */
  accept(): void {
    this.cardTargeting = null
    this.attackLine.clear()
    this.lastTargetingPointer = null
    this.cursor?.setTargeting(false)
  }

  dispose(): void {
    this.disposed = true
    const preview = this.minionTargetPreview()
    this.cardTargeting = null
    if (preview) {
      preview.cancelled = true
      this.stopMinionTargetPreviewPresentation(preview)
    }
    this.cardChoiceLayer.destroy({ children: true })
  }

  private cardTargetKey(target: CardPlayTargetRef): string {
    return target.kind === 'hero'
      ? 'hero:' + target.participantId
      : target.kind + ':' + target.instanceId
  }

  private cardTargetRef(view: CombatView): CardPlayTargetRef | null {
    if (!view.ownerId) return null
    if (view instanceof HeroView)
      return { kind: 'hero', participantId: view.ownerId as PlayerId }
    if (!view.instanceId) return null
    return {
      kind: 'minion',
      participantId: view.ownerId as PlayerId,
      instanceId: view.instanceId
    }
  }

  minionTargetPreview(
    targeting: CardPlayTargetingState | null = this.cardTargeting
  ): PendingMinionTargetPreview | null {
    return targeting?.presentation.kind === 'minion-preview'
      ? targeting.presentation.preview
      : null
  }

  isValidCardTarget(view: CombatView): boolean {
    const targeting = this.cardTargeting
    if (!targeting) return false
    if (
      targeting.presentation.kind === 'minion-preview' &&
      targeting.presentation.preview.cancelled === true
    )
      return false
    if (
      pendingCardInputStage(
        targeting.input,
        targeting.choice,
        targeting.targets.length
      ) !== 'target'
    )
      return false
    const target = this.cardTargetRef(view)
    if (!target) return false
    const options = targeting.input.legalTargetOptions[targeting.targets.length] ?? []
    const key = this.cardTargetKey(target)
    if (targeting.targets.some((selected) => this.cardTargetKey(selected) === key))
      return false
    return options.some((candidate) => this.cardTargetKey(candidate) === key)
  }

  clearCardChoiceOverlay(): void {
    const children = this.cardChoiceLayer.removeChildren()
    for (const child of children) child.destroy({ children: true })
    this.cardChoiceLayer.visible = false
    // Mandatory match choices share this surface but do not belong to targeting.
    if (this.cardTargeting) this.cardSelectionOverlay.clear()
  }

  private showCardChoiceOverlay(input: PlayCardInput): void {
    if (input.choiceOptions.length === 0) return
    void this.cardSelectionOverlay
      .showChoices(
        this.context.localParticipantId(),
        input.cardInstanceId,
        input.cardId,
        input.choiceOptions,
        this.minionTargetPreview() === null
      )
      .catch((error: unknown) => {
        this.logger.error('[GameBoardView] failed to present card choices', error)
        this.cancelCardTargeting()
      })
  }

  beginCardTargeting(
    entry: HandEntry,
    input: PlayCardInput,
    position?: number,
    arrowOriginHint: HandCardTargetingOrigin = 'card'
  ): void {
    const hasRenderableTarget =
      input.choiceCount > 0 ||
      input.targetSelectors.length === 0 ||
      input.legalTargetOptions[0]?.some(
        (target) => target.kind === 'hero' || target.kind === 'minion'
      ) === true
    if (!hasRenderableTarget) {
      this.logger.warn(
        '[GameBoardView] no renderer target adapter for ' +
          entry.card.cardId +
          '; returning card'
      )
      this.hand.drag.end()
      return
    }

    const isMinionTargetPreview =
      arrowOriginHint === 'card' &&
      cardDefinition(entry.card).type === 'Minion' &&
      (input.targetSelectors.length > 0 || input.choiceCount > 0) &&
      position !== undefined
    const previewResting = isMinionTargetPreview
      ? this.context.previewPosition(position!)
      : undefined
    const minionPreview: PendingMinionTargetPreview | undefined = isMinionTargetPreview
      ? {
          entry,
          position: position!,
          targetingOrigin: {
            x: previewResting!.x,
            y: previewResting!.y
          },
          cancelled: false,
          ready: false,
          presentation: null,
          presentationPromise: null,
          reversePromise: null,
          playEffects: new Set(),
          activeTimelines: new Set()
        }
      : undefined
    const targeting: CardPlayTargetingState = {
      cardInstanceId: entry.card.instanceId,
      input,
      targets: [],
      arrowOrigin: minionPreview
        ? 'minion-preview'
        : resolveHandCardArrowOrigin(cardDefinition(entry.card).type, arrowOriginHint),
      presentation: minionPreview
        ? { kind: 'minion-preview', preview: minionPreview }
        : { kind: 'hidden-hand-card' },
      ...(position === undefined ? {} : { position })
    }
    this.cardTargeting = targeting
    this.hand.clearHover()
    this.context.hideBoardCardPreview()
    this.context.deselectAttacker()
    this.context.cancelHeroPowerTargeting()
    if (pendingCardInputStage(input, undefined) === 'choice') {
      this.attackLine.clear()
      this.cursor?.setTargeting(false)
      this.cursor?.setTargetingTarget(null)
      this.showCardChoiceOverlay(input)
      if (minionPreview) {
        this.beginMinionTargetPreview(targeting)
        return
      }
      this.hand.drag.hideForPendingPlay(entry)
      this.context.syncAttackability()
      this.context.syncControls()
      return
    }

    if (minionPreview) {
      this.beginMinionTargetPreview(targeting)
      return
    }

    this.cursor?.setTargeting(true)
    if (this.assets.arrowBody) {
      this.attackLine.setBodyTexture(this.assets.arrowBody)
    }
    this.context.syncAttackability()
    this.context.syncControls()
    // The pending presentation is renderer-only; the command is not dispatched
    // until every required target/choice has been collected.
    this.hand.drag.hideForPendingPlay(entry)
  }

  private beginMinionTargetPreview(targeting: CardPlayTargetingState): void {
    const preview = this.minionTargetPreview(targeting)
    if (!preview) return

    this.hand.drag.releaseForTargeting(preview.entry)
    preview.entry.slot.visible = true
    this.context.showBoardPreview(preview.position, preview.entry.card.instanceId)
    this.cursor?.setTargeting(
      pendingCardInputStage(
        targeting.input,
        targeting.choice,
        targeting.targets.length
      ) === 'target'
    )
    if (this.assets.arrowBody) {
      this.attackLine.setBodyTexture(this.assets.arrowBody)
    }
    this.context.syncAttackability()
    this.context.syncControls()

    const presentationPromise = this.context
      .presentMinionPreview(preview)
      .then((presentation) => {
        preview.presentation = presentation
        // Reversal may already have finished while the view was being created.
        if (preview.cancelled || this.disposed) {
          this.stopMinionTargetPreviewPresentation(preview)
          return null
        }
        return presentation
      })

    preview.presentationPromise = presentationPromise.catch((error: unknown) => {
      this.logger.error('[GameBoardView] minion target preview failed', error)
      return null
    })

    void preview.presentationPromise.then((presentation) => {
      if (this.minionTargetPreview() !== preview || preview.cancelled) {
        void this.reverseMinionTargetPreview(preview)
        return
      }
      if (!presentation) {
        this.cancelCardTargeting()
        return
      }
      preview.ready = true
      this.context.syncAttackability()
      this.context.syncControls()
      const currentTargeting = this.cardTargeting
      if (
        currentTargeting &&
        pendingCardInputStage(
          currentTargeting.input,
          currentTargeting.choice,
          currentTargeting.targets.length
        ) === 'ready'
      ) {
        this.context.submitPendingCard()
      }
    })
  }

  cancelCardTargeting(pointer?: HandPointer): void {
    this.context.cancelCardGesture()
    this.clearCardChoiceOverlay()
    const targeting = this.cardTargeting
    if (!targeting) return
    this.attackLine.clear()
    this.cursor?.setTargeting(false)
    if (targeting.presentation.kind === 'minion-preview') {
      const preview = targeting.presentation.preview
      preview.cancelled = true
      this.cardTargeting = null
      this.hand.setReflowing(true)
      this.lastTargetingPointer = null
      if (this.context.hasSession()) {
        this.context.syncAttackability()
        this.context.syncControls()
      }
      void this.reverseMinionTargetPreview(preview).catch((error: unknown) => {
        this.logger.error(
          '[GameBoardView] minion target preview reversal failed',
          error
        )
      })
      return
    }
    this.cardTargeting = null
    if (targeting.presentation.kind === 'hidden-hand-card') {
      const entry = this.hand.entries.find(
        (candidate) => candidate.card.instanceId === targeting.cardInstanceId
      )
      const returnTo = pointer ?? this.lastTargetingPointer
      if (entry?.restTransform) {
        entry.slot.visible = true
        if (returnTo) {
          entry.slot.position.set(returnTo.x, returnTo.y)
          entry.slot.rotation = 0
          entry.slot.scale.set(DEFAULT_HAND_DRAG.dragScale)
        }
        this.hand.drag.holdForPresentation()
        void this.hand
          .animateSlotToHand(
            entry.slot,
            entry.restTransform,
            0,
            OPENING_TIMING.hover,
            OPENING_TIMING.hover
          )
          .then(() => {
            entry.slot.suppressPlayableOutline(false)
            entry.displaced = false
            this.hand.drag.presentationSettled()
          })
      } else if (entry) {
        entry.slot.visible = true
        entry.slot.suppressPlayableOutline(false)
      }
    }
    this.lastTargetingPointer = null
    if (this.context.hasSession()) {
      this.context.syncAttackability()
      this.context.syncControls()
    }
  }

  private reverseMinionTargetPreview(
    preview: PendingMinionTargetPreview
  ): Promise<void> {
    if (preview.reversePromise) return preview.reversePromise
    preview.reversePromise = (async () => {
      try {
        this.stopMinionTargetPreviewPresentation(preview)
        await this.returnMinionTargetCardToHand(preview.entry)
      } catch (error) {
        this.logger.error(
          '[GameBoardView] minion target preview reversal failed',
          error
        )
        await this.returnMinionTargetCardToHand(preview.entry)
      } finally {
        this.context.releaseSummonSlot(preview.entry.slot)
        if (this.minionTargetPreview() === preview) this.cardTargeting = null
        this.context.clearBoardPreview(preview.position, preview.entry.card.instanceId)
        this.hand.setReflowing(false)
        if (!this.disposed && !this.context.isDisposed()) {
          this.hand.activate()
          this.context.syncHud()
          this.context.syncControls()
        }
      }
    })()
    return preview.reversePromise
  }

  private stopMinionTargetPreviewPresentation(
    preview: PendingMinionTargetPreview
  ): void {
    for (const timeline of preview.activeTimelines) timeline.kill()
    preview.activeTimelines.clear()

    for (const effect of preview.playEffects) {
      if (!effect.destroyed) effect.destroy({ children: true })
    }
    preview.playEffects.clear()

    const presentation = preview.presentation
    preview.presentation = null
    if (presentation && !presentation.view.destroyed) {
      presentation.view.setTargetable(false)
      presentation.view.setTargetingOutline(false)
      presentation.view.removeFromParent()
      presentation.view.destroy({ children: true })
    }
  }

  private returnMinionTargetCardToHand(entry: HandEntry): Promise<void> {
    const slot = entry.slot
    if (slot.destroyed) return Promise.resolve()
    slot.visible = true

    const global = slot.parent ? slot.getGlobalPosition() : null
    if (slot.parent !== this.hand.layer) {
      this.hand.layer.addChild(slot)
      if (global) {
        const local = this.hand.layer.toLocal(global)
        slot.position.set(local.x, local.y)
      }
    }
    this.hand.configureSlot(slot)
    slot.suppressPlayableOutline(false)
    entry.displaced = false
    if (entry.restTransform) {
      gsap.killTweensOf(slot)
      gsap.killTweensOf(slot.scale)
      gsap.killTweensOf(slot.skew)
      slot.position.set(entry.restTransform.x, entry.restTransform.y)
      slot.rotation = entry.restTransform.rotation
      slot.scale.set(entry.restTransform.scale)
      slot.skew.set(0)
      slot.alpha = 1
      slot.zIndex = entry.restTransform.zIndex
    } else {
      slot.alpha = 1
    }
    return Promise.resolve()
  }

  commitCardTarget(view: CombatView): void {
    if (!this.cardTargeting || !this.isValidCardTarget(view)) return
    const target = this.cardTargetRef(view)
    if (!target) return
    this.cardTargeting.targets.push(target)
    const { input, targets, choice } = this.cardTargeting
    if (pendingCardInputStage(input, choice, targets.length) === 'ready') {
      this.context.submitPendingCard()
      return
    }
    this.context.syncAttackability()
  }

  commitCardTargetAt(pointer: HandPointer): boolean {
    this.lastTargetingPointer = pointer
    const target = this.context.findTargetAt(pointer.x, pointer.y)
    if (!target || !this.isValidCardTarget(target)) return false
    this.commitCardTarget(target)
    return true
  }

  chooseCardPlayOption(choice: number, choiceAnimated = false): void {
    const targeting = this.cardTargeting
    if (!targeting || !targeting.input.legalChoices.includes(choice)) return
    this.cardSelectionOverlay.clear()
    const input = this.context.getPlayInput(targeting.cardInstanceId, choice)
    if (!input) {
      this.cancelCardTargeting()
      return
    }
    this.cardTargeting = {
      ...targeting,
      input,
      targets: [],
      choice,
      choiceAnimated
    }
    const preview = this.minionTargetPreview()
    if (preview && !preview.presentationPromise) {
      this.beginMinionTargetPreview(this.cardTargeting)
      return
    }
    if (input.targetSelectors.length > 0) {
      this.cursor?.setTargeting(true)
      if (this.assets.arrowBody) this.attackLine.setBodyTexture(this.assets.arrowBody)
    }
    this.context.syncAttackability()
    this.context.syncControls()
    if (pendingCardInputStage(input, choice) === 'ready')
      this.context.submitPendingCard()
  }

  syncPendingMinionTargetPreview(): void {
    const preview = this.minionTargetPreview()?.presentation
    if (!preview) return
    const targetable = this.isValidCardTarget(preview.view)
    preview.view.setTargetable(targetable)
    preview.view.setTargetingOutline(targetable)
  }
}
