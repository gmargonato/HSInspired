import { describe, expect, it } from 'vitest'
import { asHeroId } from '../../../game/content/cards'
import { getDeckPortraitAssetKey, getDeckPortraitYOffset } from './deck-portraits'

describe('deck portrait asset keys', () => {
  it('resolves original-art portraits for selectable heroes', () => {
    expect(getDeckPortraitAssetKey(asHeroId('guldan'))).toBe('guldanDeckPortrait')
    expect(getDeckPortraitAssetKey(asHeroId('jaina'))).toBe('jainaDeckPortrait')
  })

  it('leaves heroes without an original deck portrait unresolved', () => {
    expect(getDeckPortraitAssetKey(asHeroId('jaraxxus'))).toBeUndefined()
  })

  it('applies custom lower crops only to the requested heroes', () => {
    expect(getDeckPortraitYOffset(asHeroId('rexxar'))).toBe(20)
    expect(getDeckPortraitYOffset(asHeroId('guldan'))).toBeUndefined()
  })
})
