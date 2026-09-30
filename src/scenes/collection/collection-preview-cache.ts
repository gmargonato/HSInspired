import type { Container } from 'pixi.js'

export const COLLECTION_PREVIEW_CACHE_OPTIONS = {
  resolution: 1,
  antialias: false
} as const

type CacheableCollectionRoot = Pick<Container, 'cacheAsTexture' | 'isCachedAsTexture'>

/**
 * Freezes the paused Collection into one GPU texture while a modal scene is
 * above it. The Collection is static at that point, so rebuilding its blur on
 * every preview frame only wastes fill rate.
 */
export function setCollectionPreviewCached(
  root: CacheableCollectionRoot,
  cached: boolean
): void {
  if (root.isCachedAsTexture === cached) return
  root.cacheAsTexture(cached ? COLLECTION_PREVIEW_CACHE_OPTIONS : false)
}
