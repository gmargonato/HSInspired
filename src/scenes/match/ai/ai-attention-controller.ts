import type { AiDecisionIdentity } from '../../../desktop/contracts/ipc/ai'
import type { AiActionIntent } from '../../../desktop/contracts/ipc/ai-deliberation'

export interface AiCandidateUpdate extends AiDecisionIdentity {
  readonly actionId: string
}

/** Optional local search telemetry. It never authorizes an engine command. */
export interface AiCandidateSource {
  onCandidate(listener: (candidate: AiCandidateUpdate) => void): () => void
}

export interface AiAttention extends AiDecisionIdentity {
  readonly intent: AiActionIntent
}

export const AI_ATTENTION_TIMING = {
  delayMs: 350,
  gestureMinMs: 600,
  gestureMaxMs: 1000,
  quietMinMs: 2000,
  quietMaxMs: 4000,
  repeatAfterMs: 8000,
  handMotionSeconds: 0.22
} as const

/** Brief single-object gestures sampled from the latest candidate, with quiet gaps. */
export class AiAttentionController {
  private latest: AiAttention | null = null
  private shown: AiAttention | null = null
  private readySince: number | null = null
  private hideAt = 0
  private nextGestureAt = 0
  private quietForMs = 0
  private lastRef: string | null = null
  private lastShownAt = -Infinity
  private sampledKey: string | null = null
  private sampledRef: string | null = null

  constructor(
    private readonly present: (value: AiAttention | null) => void,
    // Cosmetic variation is independent of the seeded match/search RNG.
    private readonly random: () => number = Math.random
  ) {}

  offer(value: AiAttention | null): void {
    if (!value) {
      this.clear()
      return
    }
    if (
      this.latest &&
      (this.latest.requestId !== value.requestId ||
        this.latest.expectedRevision !== value.expectedRevision)
    )
      this.clear()
    this.latest = value
  }

  update(now: number, ready: boolean, revision: number): void {
    if (this.latest && this.latest.expectedRevision !== revision) this.clear()
    if (!ready) {
      this.hide()
      this.readySince = null
      return
    }
    this.readySince ??= now
    if (this.shown) {
      if (now >= this.hideAt) {
        this.hide()
        this.nextGestureAt = now + this.quietForMs
      }
      return
    }
    if (
      !this.latest ||
      now < this.nextGestureAt ||
      now - this.readySince < AI_ATTENTION_TIMING.delayMs
    )
      return
    const intent = this.latest.intent
    // Hand consideration stays a card-back gesture; never expose its target too.
    const refs = [
      ...new Set(
        intent.type === 'play-card'
          ? [intent.source]
          : [intent.source, ...intent.targets]
      )
    ].filter((ref): ref is string => ref !== null)
    if (!refs.length) return
    const key = JSON.stringify([intent.type, ...refs])
    if (key !== this.sampledKey) {
      this.sampledKey = key
      this.sampledRef = refs[Math.floor(this.random() * refs.length)]!
    }
    // A stable attack must not become an alternating attacker/target demonstration.
    const ref = this.sampledRef!
    if (
      ref === this.lastRef &&
      now - this.lastShownAt < AI_ATTENTION_TIMING.repeatAfterMs
    )
      return
    this.lastRef = ref
    this.lastShownAt = now
    this.hideAt =
      now +
      this.between(AI_ATTENTION_TIMING.gestureMinMs, AI_ATTENTION_TIMING.gestureMaxMs)
    this.quietForMs = this.between(
      AI_ATTENTION_TIMING.quietMinMs,
      AI_ATTENTION_TIMING.quietMaxMs
    )
    this.nextGestureAt = this.hideAt + this.quietForMs
    this.shown = { ...this.latest, intent: { ...intent, source: ref, targets: [] } }
    this.present(this.shown)
  }

  private between(min: number, max: number): number {
    return min + this.random() * (max - min)
  }

  clear(): void {
    // Keep the quiet gap across decisions so quick consecutive plays cannot flash.
    this.latest = null
    this.readySince = null
    this.hide()
  }

  private hide(): void {
    if (!this.shown) return
    this.shown = null
    this.present(null)
  }
}
