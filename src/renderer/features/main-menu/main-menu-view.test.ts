import { Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import type { MainMenuAssets } from '../../ui/asset-registry'
import type { AssetScope } from '../../ui/asset-registry/asset-scope'
import { MainMenuView } from './main-menu-view'

const testAssets: MainMenuAssets = {
  table: Texture.EMPTY,
  box: Texture.EMPTY,
  leftLid: Texture.EMPTY,
  rightLid: Texture.EMPTY,
  centerPart: Texture.EMPTY,
  centerPartMenu: Texture.EMPTY,
  buttonPlay: Texture.EMPTY,
  buttonCollection: Texture.EMPTY
}

describe('MainMenuView', () => {
  it('keeps the transition host between the chest body and animated menu group', async () => {
    const assetScope = {
      acquire: vi.fn().mockResolvedValue(testAssets)
    } as unknown as AssetScope
    const view = new MainMenuView({ assetScope })

    await view.init()

    expect(view.children.map((child) => child.label)).toEqual([
      'main-menu.background',
      'main-menu.chest-box-layer',
      'main-menu.transition-host',
      'main-menu.menu-group'
    ])
    expect(view.transitionHost.parent).toBe(view)

    view.dispose()
  })
})
