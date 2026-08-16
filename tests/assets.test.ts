import { Assets } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { ASSET_BUNDLE_IDS } from '../src/renderer/src/core/assets'
import { AssetScope } from '../src/renderer/src/core/assetScope'

describe('AssetScope', () => {
  it('shares concurrent loads and unloads only after the final release', async () => {
    const loadBundle = vi.spyOn(Assets, 'loadBundle').mockResolvedValue({ table: {} })
    const unloadBundle = vi.spyOn(Assets, 'unloadBundle').mockResolvedValue(undefined)
    const first = new AssetScope()
    const second = new AssetScope()

    await Promise.all([
      first.acquire(ASSET_BUNDLE_IDS.mainMenu),
      second.acquire(ASSET_BUNDLE_IDS.mainMenu)
    ])

    expect(loadBundle).toHaveBeenCalledTimes(1)

    await first.releaseAll()
    expect(unloadBundle).not.toHaveBeenCalled()

    await second.releaseAll()
    expect(unloadBundle).toHaveBeenCalledTimes(1)

    vi.restoreAllMocks()
  })
})
