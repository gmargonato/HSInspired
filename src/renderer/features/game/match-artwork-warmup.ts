import { RenderTexture, Sprite, type Renderer, type TextureSource } from 'pixi.js'
import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_CATALOG } from '../../../game/content/heroes'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import type { Deck } from '../../../game/decks'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import type { RendererLogger } from '../../ui/logger'

const MAX_REFERENCED_ARTWORK = 128
const LOAD_BATCH_SIZE = 4

/** Follow explicit references only; never expand catalog-wide random selectors. */
export function matchArtworkIds(
  decks: readonly Pick<Deck, 'cards'>[],
  heroPowerIds: readonly string[]
): readonly string[] {
  const ids = new Set(decks.flatMap((deck) => Object.keys(deck.cards)))
  ids.add('basic_the_coin')
  const limit = ids.size + MAX_REFERENCED_ARTWORK
  const powers = new Set<string>()
  const add = (id: string): void => {
    if (ids.size < limit && CARD_CATALOG.get(id)) ids.add(id)
  }
  const visitPower = (id: string): void => {
    if (powers.has(id)) return
    powers.add(id)
    visit(HERO_POWER_CATALOG.get(id)?.effect)
  }
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 16) return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1)
      return
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'excludeCardId') continue
      if ((key === 'cardId' || key.endsWith('CardId')) && typeof entry === 'string') {
        add(entry)
      } else if ((key === 'cardIds' || key === 'pool') && Array.isArray(entry)) {
        for (const id of entry) if (typeof id === 'string') add(id)
      } else if (key === 'heroPowerId' && typeof entry === 'string') {
        visitPower(entry)
      }
      visit(entry, depth + 1)
    }
  }
  for (const id of heroPowerIds) visitPower(id)
  // Set iteration includes newly discovered references; deduplication breaks cycles.
  for (const id of ids) {
    const card = CARD_CATALOG.get(id)
    if (!card) continue
    visit(card.effects)
    if (card.type === 'Spell') visit(card.quest)
    if (card.type === 'Hero') {
      const hero = HERO_CATALOG.get(card.replacementHeroId)
      if (hero) visitPower(hero.heroPowerId)
    }
  }
  return [...ids]
}

// Asset sources can be shared by overlapping scenes. Restore GC only after the
// last match lease ends; never destroy textures owned by Pixi's asset cache.
const residency = new WeakMap<TextureSource, { count: number; automatic: boolean }>()

export class MatchArtworkWarmup {
  private readonly sources = new Set<TextureSource>()
  private disposed = false

  constructor(
    private readonly renderer: Renderer,
    private readonly resolver: CardAssetResolver,
    private readonly logger: RendererLogger
  ) {}

  async prepare(
    ids: readonly string[],
    onProgress?: (progress: number) => Promise<void>
  ): Promise<void> {
    if (this.disposed) return
    const started = performance.now()
    const sample = new Sprite()
    sample.label = 'game.artwork-warmup'
    let output: RenderTexture | undefined
    let uploaded = 0
    try {
      output = RenderTexture.create({ width: 8, height: 8, resolution: 1 })
      for (
        let offset = 0;
        offset < ids.length && !this.disposed;
        offset += LOAD_BATCH_SIZE
      ) {
        const batch = ids.slice(offset, offset + LOAD_BATCH_SIZE)
        const results = await Promise.allSettled(
          batch.map((id) => this.resolver.loadArtwork(id))
        )
        if (this.disposed) return
        for (const [index, result] of results.entries()) {
          if (result.status === 'rejected') {
            this.logger.warn(
              '[GameBoardView] artwork warmup load failed',
              batch[index],
              result.reason
            )
            continue
          }
          const texture = result.value
          if (!texture || this.sources.has(texture.source)) continue
          try {
            sample.texture = texture
            sample.width = 8
            sample.height = 8
            // A real draw uploads the source and generates its configured mipmaps.
            this.renderer.render({ container: sample, target: output, clear: true })
            const source = texture.source
            const lease = residency.get(source) ?? {
              count: 0,
              automatic: source.autoGarbageCollect
            }
            lease.count++
            residency.set(source, lease)
            source.autoGarbageCollect = false
            this.sources.add(source)
            uploaded++
          } catch (error) {
            this.logger.warn(
              '[GameBoardView] artwork warmup upload failed',
              batch[index],
              error
            )
          }
        }
        if (onProgress)
          await onProgress(Math.min(1, (offset + batch.length) / ids.length))
        else await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      this.logger.warn('[GameBoardView] artwork warmup failed', error)
    } finally {
      sample.destroy({ texture: false })
      output?.destroy(true)
      if (import.meta.env.DEV) {
        this.logger.info('[GameBoardView] artwork warmup', {
          milliseconds: performance.now() - started,
          requested: ids.length,
          uploaded
        })
      }
    }
  }

  dispose(): void {
    this.disposed = true
    for (const source of this.sources) {
      const lease = residency.get(source)!
      if (--lease.count === 0) {
        source.autoGarbageCollect = lease.automatic
        residency.delete(source)
      }
    }
    this.sources.clear()
  }
}
