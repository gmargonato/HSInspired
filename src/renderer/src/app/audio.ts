import backClickUrl from '@assets/audio/back-click.ogg'
import hubClickUrl from '@assets/audio/hub-click.ogg'
import hubMouseoverUrl from '@assets/audio/hub-mouseover.ogg'
import boxHubButtonPressUrl from '@assets/audio/box-hub-button-press-1.ogg'
import cardLimitLockUrl from '@assets/audio/card-limit-lock.ogg'
import collectionLatchUrl from '@assets/audio/collection-manager-book-latch-jiggle.ogg'
import collectionCoverOpenUrl from '@assets/audio/collection-manager-book-open.ogg'
import collectionCardPreviewUrl from '@assets/audio/collection-manager-pick-up-card.ogg'
import collectionCardAddUrl from '@assets/audio/collection-manager-card-add-to-deck-instant.ogg'
import collectionSelectHeroUrl from '@assets/audio/collection-manager-select-hero.ogg'
import collectionNewDeckEdgeFlipsUrl from '@assets/audio/collection-manager-new-deck-edge-flips.ogg'
import collectionPageFlipForwardUrl from '@assets/audio/collection-manager-book-page-flip-forward.ogg'
import collectionPageFlipForward3Url from '@assets/audio/collection-manager-book-page-flip-forward-3.ogg'
import collectionPageFlipBackUrl from '@assets/audio/collection-manager-book-page-flip-back.ogg'
import collectionPageFlipBack3Url from '@assets/audio/collection-manager-book-page-flip-back-3.ogg'
import collectionDeckSelectUrl from '@assets/audio/deck-select-button-press.ogg'

export const SOUND_EFFECT_URLS = {
  'back-click': backClickUrl,
  'hub-click': hubClickUrl,
  'hub-mouseover': hubMouseoverUrl,
  'box-hub-button-press': boxHubButtonPressUrl,
  'card-limit-lock': cardLimitLockUrl,
  'collection-latch': collectionLatchUrl,
  'collection-cover-open': collectionCoverOpenUrl,
  'collection-card-preview': collectionCardPreviewUrl,
  'collection-card-add': collectionCardAddUrl,
  'collection-select-hero': collectionSelectHeroUrl,
  'collection-new-deck-edge-flips': collectionNewDeckEdgeFlipsUrl,
  'collection-page-flip-forward': collectionPageFlipForwardUrl,
  'collection-page-flip-forward-3': collectionPageFlipForward3Url,
  'collection-page-flip-back': collectionPageFlipBackUrl,
  'collection-page-flip-back-3': collectionPageFlipBack3Url,
  'collection-deck-select': collectionDeckSelectUrl
} as const

export type SoundEffectId = keyof typeof SOUND_EFFECT_URLS

interface AudioResponse {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  arrayBuffer(): Promise<ArrayBuffer>
}

interface AudioLogger {
  warn(message: string, ...details: readonly unknown[]): void
}

export interface AudioServiceOptions {
  contextFactory?: () => AudioContext
  fetcher?: (url: string) => Promise<AudioResponse>
  sources?: Readonly<Record<SoundEffectId, string>>
  logger?: AudioLogger
}

/**
 * Application-lifetime cache for short sound effects.
 *
 * Every configured file is fetched and decoded by preload(). play() only
 * creates a lightweight source node from an already-decoded AudioBuffer.
 */
export class AudioService {
  private readonly contextFactory: () => AudioContext
  private readonly fetcher: (url: string) => Promise<AudioResponse>
  private readonly sources: Readonly<Record<SoundEffectId, string>>
  private readonly logger: AudioLogger
  private readonly buffers = new Map<SoundEffectId, AudioBuffer>()
  private readonly activeSources = new Set<AudioBufferSourceNode>()
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private preloadPromise: Promise<void> | null = null
  private resumePromise: Promise<void> | null = null
  private masterVolume = 1
  private disposed = false

  constructor(options: AudioServiceOptions = {}) {
    this.contextFactory = options.contextFactory ?? (() => new AudioContext())
    this.fetcher = options.fetcher ?? ((url) => fetch(url))
    this.sources = options.sources ?? SOUND_EFFECT_URLS
    this.logger = options.logger ?? { warn: () => undefined }
  }

  preload(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.preloadPromise ??= this.preloadAll()
    return this.preloadPromise
  }

  play(effectId: SoundEffectId): void {
    if (this.disposed || !this.buffers.has(effectId)) return

    const context = this.context
    if (!context) return

    if (context.state === 'running') {
      this.startSource(effectId)
      return
    }

    void this.resume().then(() => {
      if (context.state === 'running') this.startSource(effectId)
    })
  }

  playRandom(effectIds: readonly SoundEffectId[]): void {
    if (effectIds.length === 0) return

    const effectId = effectIds[Math.floor(Math.random() * effectIds.length)]
    if (effectId) this.play(effectId)
  }

  /** Resume a suspended context from a user-activation event. */
  unlock(): void {
    if (this.disposed || !this.context || this.context.state === 'running') return
    void this.resume()
  }

  setMasterVolume(value: number): void {
    this.masterVolume = Math.max(0, Math.min(1, value))
    if (this.masterGain) this.masterGain.gain.value = this.masterVolume
  }

  getMasterVolume(): number {
    return this.masterVolume
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true

    for (const source of this.activeSources) {
      source.onended = null
      try {
        source.stop()
      } catch {
        // A source that has already ended cannot always be stopped again.
      }
      source.disconnect()
    }
    this.activeSources.clear()
    this.buffers.clear()

    this.masterGain?.disconnect()
    this.masterGain = null

    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') {
      await context.close().catch((error: unknown) => {
        this.logger.warn('Failed to close the audio context.', error)
      })
    }
  }

  private async preloadAll(): Promise<void> {
    try {
      const context = this.contextFactory()
      const masterGain = context.createGain()
      masterGain.gain.value = this.masterVolume
      masterGain.connect(context.destination)
      this.context = context
      this.masterGain = masterGain

      await Promise.all(
        Object.entries(this.sources).map(async ([effectId, url]) => {
          try {
            const response = await this.fetcher(url)
            if (!response.ok) {
              throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
            }

            const encodedAudio = await response.arrayBuffer()
            const buffer = await context.decodeAudioData(encodedAudio)
            if (!this.disposed) this.buffers.set(effectId as SoundEffectId, buffer)
          } catch (error) {
            this.logger.warn(`Failed to preload sound effect "${effectId}":`, error)
          }
        })
      )
    } catch (error) {
      this.logger.warn('Sound effects are unavailable.', error)
    }
  }

  private resume(): Promise<void> {
    const context = this.context
    if (!context || context.state === 'running') return Promise.resolve()

    this.resumePromise ??= context
      .resume()
      .catch((error: unknown) => {
        this.logger.warn('Failed to resume the audio context.', error)
      })
      .finally(() => {
        this.resumePromise = null
      })
    return this.resumePromise
  }

  private startSource(effectId: SoundEffectId): void {
    const context = this.context
    const masterGain = this.masterGain
    const buffer = this.buffers.get(effectId)
    if (this.disposed || !context || !masterGain || !buffer) return

    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(masterGain)
    source.onended = () => {
      source.disconnect()
      this.activeSources.delete(source)
    }
    this.activeSources.add(source)
    source.start()
  }
}
