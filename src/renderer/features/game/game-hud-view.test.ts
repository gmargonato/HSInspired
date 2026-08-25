import { Texture } from 'pixi.js'
import { describe, expect, it, vi } from 'vitest'
import { CardAssetResolver } from '../../ui/asset-registry/card-asset-resolver'
import { GameHudView } from './game-hud-view'

describe('GameHudView', () => {
  it('keeps the End Turn button subtree hit-testable', () => {
    const hud = new GameHudView(new CardAssetResolver())

    expect(hud.turnLayer.eventMode).toBe('passive')

    hud.mount({ endTurn: Texture.EMPTY, manaCrystal: Texture.EMPTY }, vi.fn())

    expect(hud.endTurnButton?.parent).toBe(hud.turnLayer)
    expect(hud.endTurnButton?.eventMode).toBe('none')

    hud.endTurnButton?.setEnabled(true)
    expect(hud.endTurnButton?.eventMode).toBe('static')

    hud.dispose()
  })
})
