import type { Container } from 'pixi.js'
import type { PlayCardInput, CardPlayTargetRef } from '../../../game-rules/match'
import type { MinionView } from '../board/minion-view'
import type { GameCardSlot } from '../hand/game-card-slot'
import type { HandEntry } from '../hand/game-hand-entry'
import type { HandCardTargetingOrigin } from '../hand/hand-play-gesture'

export interface MinionPreviewPresentation {
  readonly view: MinionView
  readonly slot: GameCardSlot
  readonly resting: { readonly x: number; readonly y: number; readonly scale: number }
}

export interface PendingMinionTargetPreview {
  readonly entry: HandEntry
  readonly position: number
  /** Final summon-layer position used as the targeting arrow's fixed source. */
  readonly targetingOrigin: { readonly x: number; readonly y: number }
  cancelled: boolean
  ready: boolean
  presentation: MinionPreviewPresentation | null
  presentationPromise: Promise<MinionPreviewPresentation | null> | null
  reversePromise: Promise<void> | null
  readonly playEffects: Set<Container>
  readonly activeTimelines: Set<gsap.core.Timeline>
}

export interface CardPlayTargetingState {
  readonly cardInstanceId: string
  readonly input: PlayCardInput
  readonly targets: CardPlayTargetRef[]
  readonly position?: number
  /** Visual arrow source. This is independent from hand-card restoration. */
  readonly arrowOrigin: HandCardTargetingOrigin
  /** Presentation staged while the authoritative card remains pending. */
  readonly presentation:
    | { readonly kind: 'hidden-hand-card' }
    | { readonly kind: 'minion-preview'; readonly preview: PendingMinionTargetPreview }
  choice?: number
  readonly choiceAnimated?: boolean
}
