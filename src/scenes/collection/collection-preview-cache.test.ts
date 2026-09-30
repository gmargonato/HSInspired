import { describe, expect, it, vi } from 'vitest'
import { Container } from 'pixi.js'
import { isArtworkVisible } from '../../visual-components/effects/premium-artwork-breath'
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
  it('pauses grid artwork behind a preview and resumes after closing it', () => {
    const stage = new Container()
    const collection = new Container()
    const artwork = new Container()
    const preview = new Container()
    const previewArtwork = new Container()
    stage.addChild(collection, preview)
    collection.addChild(artwork)
    preview.addChild(previewArtwork)
    try {
      expect(isArtworkVisible(artwork)).toBe(true)
      setCollectionPreviewCached(collection, true)
      expect(isArtworkVisible(artwork)).toBe(false)
      expect(isArtworkVisible(previewArtwork)).toBe(true)
      setCollectionPreviewCached(collection, false)
      expect(isArtworkVisible(artwork)).toBe(true)
      collection.visible = false
      expect(isArtworkVisible(artwork)).toBe(false)
    } finally {
      stage.destroy({ children: true })
    }
  })

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
