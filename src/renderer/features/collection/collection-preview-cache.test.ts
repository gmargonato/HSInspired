import { describe, expect, it, vi } from 'vitest'
import {
  COLLECTION_PREVIEW_CACHE_OPTIONS,
  setCollectionPreviewCached
} from './collection-preview-cache'

function cacheTarget(initiallyCached = false) {
  const target = {
    isCachedAsTexture: initiallyCached,
    cacheAsTexture: vi.fn((value: boolean | object) => {
      target.isCachedAsTexture = value !== false
    })
  }
  return target
}

describe('collection preview cache', () => {
  it('enables a bounded static texture once', () => {
    const target = cacheTarget()

    setCollectionPreviewCached(target, true)
    setCollectionPreviewCached(target, true)

    expect(target.cacheAsTexture).toHaveBeenCalledOnce()
    expect(target.cacheAsTexture).toHaveBeenCalledWith(COLLECTION_PREVIEW_CACHE_OPTIONS)
  })

  it('releases the texture when the Collection resumes', () => {
    const target = cacheTarget(true)

    setCollectionPreviewCached(target, false)
    setCollectionPreviewCached(target, false)

    expect(target.cacheAsTexture).toHaveBeenCalledOnce()
    expect(target.cacheAsTexture).toHaveBeenCalledWith(false)
  })
})
