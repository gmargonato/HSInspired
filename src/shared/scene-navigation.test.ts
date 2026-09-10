import { describe, expect, it } from 'vitest'
import {
  DEV_MATCH_MENU_ENTRIES,
  isSceneRequest,
  SCENE_MENU_ENTRIES
} from './scene-navigation'

describe('scene navigation contract', () => {
  it('exposes and accepts the Arena scene request', () => {
    expect(SCENE_MENU_ENTRIES.arena).toEqual({
      label: 'Arena',
      request: { id: 'arena' }
    })
    expect(isSceneRequest({ id: 'arena' })).toBe(true)
  })

  it('exposes and accepts the Tavern Brawl scene request', () => {
    expect(SCENE_MENU_ENTRIES['tavern-brawl']).toEqual({
      label: 'Tavern Brawl',
      request: { id: 'tavern-brawl' }
    })
    expect(isSceneRequest({ id: 'tavern-brawl' })).toBe(true)
  })

  it('exposes and accepts the development Shader Lab request', () => {
    expect(SCENE_MENU_ENTRIES['outline-lab']).toEqual({
      label: 'Shader Lab',
      request: { id: 'outline-lab' }
    })
    expect(isSceneRequest({ id: 'outline-lab' })).toBe(true)
  })

  it('exposes and accepts the Card Class Color Lab request', () => {
    expect(SCENE_MENU_ENTRIES['card-inspector']).toEqual({
      label: 'Card Class Color Lab',
      request: { id: 'card-inspector' }
    })
    expect(isSceneRequest({ id: 'card-inspector' })).toBe(true)
  })

  it('exposes exactly the three development Match launch options', () => {
    expect(Object.values(DEV_MATCH_MENU_ENTRIES).map((entry) => entry.label)).toEqual([
      'Start as First player',
      'Start as Second player',
      'Skip mulligan'
    ])
    for (const entry of Object.values(DEV_MATCH_MENU_ENTRIES))
      expect(isSceneRequest(entry.request)).toBe(true)
    expect(isSceneRequest({ id: 'game', params: { launchMode: 'invalid' } })).toBe(
      false
    )
  })
})
