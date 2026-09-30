import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Container,
  DOMAdapter,
  Text,
  type Renderer,
  Texture,
  type Sprite,
  type FederatedPointerEvent
} from 'pixi.js'
import { ArenaView } from './arena-view'
import type { ArenaStore } from '../../application/contracts/arena-store'
import type {
  DeckPresentationAssets,
  SharedUIAssets
} from '../../visual-components/assets'
import { ArenaRewardsView } from './arena-rewards-view'
import { arenaRewardPosition } from './arena-rewards-layout'
import { CardAssetResolver } from '../../visual-components/assets/card-asset-resolver'
import { CardView } from '../../visual-components/cards/card-view'
import type { ArenaAssets } from '../../visual-components/assets'
import type { ArenaRewardReceipt } from '../../game-rules'
import {
  ARENA_DECK_ID,
  HERO_CATALOG,
  asCardId,
  type ArenaRunSnapshot
} from '../../game-rules'
import { buildArenaDeckEntries, buildArenaManaCurve } from './arena-model'

function run(cards: Readonly<Record<string, number>>): ArenaRunSnapshot {
  const timestamp = new Date(0).toISOString()
  return {
    runId: 'test-run',
    rewards: null,
    id: ARENA_DECK_ID,
    phase: 'drafting',
    heroChoices: [
      HERO_CATALOG.require('jaina').id,
      HERO_CATALOG.require('guldan').id,
      HERO_CATALOG.require('rexxar').id
    ],
    heroId: HERO_CATALOG.require('jaina').id,
    cardChoices: [
      asCardId('basic_arcane_missiles'),
      asCardId('basic_fireball'),
      asCardId('basic_frostbolt')
    ],
    cards,
    picksCompleted: Object.values(cards).reduce((sum, count) => sum + count, 0),
    gamesPlayed: 0,
    wins: 0,
    defeats: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

describe('Arena presentation model', () => {
  it('sorts grouped deck entries by mana cost then name', () => {
    const entries = buildArenaDeckEntries(
      run({ basic_fireball: 2, basic_arcane_missiles: 1 })
    )
    expect(entries.map((entry) => entry.card.id)).toEqual([
      'basic_arcane_missiles',
      'basic_fireball'
    ])
    expect(entries[1].count).toBe(2)
  })

  it('groups seven-or-more mana cards in the final curve bucket', () => {
    const curve = buildArenaManaCurve(
      run({ basic_arcane_missiles: 2, basic_flamestrike: 3 })
    )
    expect(curve[1]).toBe(2)
    expect(curve[7]).toBe(3)
  })
})

describe('Arena reward overlay', () => {
  const assets = {
    rewardBox: Texture.WHITE,
    rewardDust: Texture.WHITE,
    confirmReward: Texture.WHITE
  } as ArenaAssets
  const views: ArenaRewardsView[] = []
  const event = {
    button: 0,
    stopPropagation: () => undefined
  } as unknown as FederatedPointerEvent
  const receipt: ArenaRewardReceipt = {
    runId: 'test-run',
    wins: 0,
    prizes: [{ kind: 'dust', amount: 15 }]
  }
  const flush = async () => {
    for (let tick = 0; tick < 8; tick++) await Promise.resolve()
  }
  beforeEach(() => {
    vi.spyOn(DOMAdapter.get(), 'createCanvas').mockReturnValue({
      getContext: () => null
    } as unknown as HTMLCanvasElement)
  })
  afterEach(() => {
    views.splice(0).forEach((view) => {
      if (!view.destroyed) view.dispose()
    })
    vi.restoreAllMocks()
  })

  it('keeps 1–5 prize positions within the screen and clear of Confirm', () => {
    for (let count = 1; count <= 5; count++) {
      const positions = Array.from({ length: count }, (_, index) =>
        arenaRewardPosition(index, count)
      )
      for (const { x, y } of positions) {
        expect(x - 150).toBeGreaterThan(0)
        expect(x + 150).toBeLessThan(1920)
        expect(y - 158).toBeGreaterThan(0)
        expect(y + 158).toBeLessThan(1080)
        expect(Math.hypot(x - 960, y - 540)).toBeGreaterThan(290)
      }
      for (let i = 0; i < count; i++)
        for (let j = i + 1; j < count; j++)
          expect(
            Math.hypot(positions[i].x - positions[j].x, positions[i].y - positions[j].y)
          ).toBeGreaterThan(315)
    }
  })

  it('reveals dust only once and allows Confirm with unopened boxes', async () => {
    const confirm = vi.fn().mockResolvedValue(undefined)
    const view = new ArenaRewardsView(receipt, assets, confirm, vi.fn())
    views.push(view)
    const box = view.getChildByLabel('arena.reward-box.0', true) as Sprite
    expect(box.anchor.x).toBe(0.5)
    box.emit('pointertap', event)
    box.emit('pointertap', event)
    expect(view.getChildrenByLabel('arena.reward-prize.0', true)).toHaveLength(1)
    const unopened = new ArenaRewardsView(receipt, assets, confirm, vi.fn())
    views.push(unopened)
    unopened.getChildByLabel('arena.reward-confirm')!.emit('pointertap', event)
    await flush()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(unopened.getChildByLabel('arena.reward-prize.0', true)).toBeNull()
  })

  it('retains the overlay for acknowledgement retries', async () => {
    const onError = vi.fn()
    const confirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('save failed'))
      .mockResolvedValue(undefined)
    const view = new ArenaRewardsView(receipt, assets, confirm, onError)
    views.push(view)
    const button = view.getChildByLabel('arena.reward-confirm')!
    button.emit('pointertap', event)
    await flush()
    expect(onError).toHaveBeenCalledOnce()
    expect(button.eventMode).toBe('static')
    button.emit('pointertap', event)
    await flush()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('renders premiums explicitly and discards late artwork after disposal', async () => {
    const premium: ArenaRewardReceipt = {
      runId: 'premium-run',
      wins: 0,
      prizes: [{ kind: 'premium', cardId: asCardId('basic_fireball'), refundValue: 50 }]
    }
    let resolve!: (texture: Texture) => void
    const load = vi
      .spyOn(CardAssetResolver.prototype, 'loadArtwork')
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done
          })
      )
    const render = vi.spyOn(CardView, 'create')
    const view = new ArenaRewardsView(premium, assets, vi.fn(), vi.fn())
    views.push(view)
    view.getChildByLabel('arena.reward-box.0', true)!.emit('pointertap', event)
    view.dispose()
    resolve(Texture.WHITE)
    await flush()
    expect(render).not.toHaveBeenCalled()
    load.mockResolvedValue(Texture.WHITE)
    const card = Object.assign(new Container(), {
      plan: { width: 620 },
      renderedHeight: 900
    })
    render.mockResolvedValue(card as unknown as CardView)
    const active = new ArenaRewardsView(premium, assets, vi.fn(), vi.fn())
    views.push(active)
    active.getChildByLabel('arena.reward-box.0', true)!.emit('pointertap', event)
    await flush()
    expect(render).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      artwork: Texture.WHITE,
      premium: true
    })
    expect(card.scale.x).toBe(0.35)
    expect(card.pivot.x).toBe(310)
    expect(card.pivot.y).toBe(450)
  })

  it('shows a prize name when artwork fails and keeps Confirm available', async () => {
    vi.spyOn(CardAssetResolver.prototype, 'loadArtwork').mockRejectedValue(
      new Error('missing artwork')
    )
    const view = new ArenaRewardsView(
      {
        runId: 'run',
        wins: 0,
        prizes: [
          { kind: 'premium', cardId: asCardId('basic_fireball'), refundValue: 50 }
        ]
      },
      assets,
      vi.fn(),
      vi.fn()
    )
    views.push(view)
    view.getChildByLabel('arena.reward-box.0', true)!.emit('pointertap', event)
    await flush()
    expect(view.getChildByLabel('arena.reward-prize.0', true)).toBeTruthy()
    expect(view.getChildByLabel('arena.reward-confirm')!.eventMode).toBe('static')
  })
})

describe('Arena developer controls', () => {
  it('gates scores by phase and busy state, refreshes saved scores, and reuses retirement confirmation', async () => {
    const canvas = vi
      .spyOn(DOMAdapter.get(), 'createCanvas')
      .mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement)
    const width = vi.spyOn(Text.prototype, 'width', 'get').mockReturnValue(100)
    const height = vi.spyOn(Text.prototype, 'height', 'get').mockReturnValue(30)
    const artwork = vi
      .spyOn(CardAssetResolver.prototype, 'loadArtwork')
      .mockResolvedValue(undefined)
    const textureAssets = new Proxy({}, { get: () => Texture.WHITE })
    const initial: ArenaRunSnapshot = {
      ...run({}),
      phase: 'choosing-hero',
      heroId: null,
      cardChoices: null
    }
    const ready: ArenaRunSnapshot = {
      ...run({ basic_fireball: 30 }),
      phase: 'ready',
      cardChoices: null
    }
    let completeSave!: (snapshot: ArenaRunSnapshot) => void
    const devSetScore = vi.fn(
      () =>
        new Promise<ArenaRunSnapshot>((resolve) => {
          completeSave = resolve
        })
    )
    const retire = vi.fn().mockResolvedValue(initial)
    const store = { devSetScore, retire } as unknown as ArenaStore
    const availability = vi.fn()
    const view = new ArenaView(
      store,
      textureAssets as ArenaAssets,
      textureAssets as DeckPresentationAssets,
      textureAssets as SharedUIAssets,
      {} as Renderer,
      { onBack: vi.fn(), onPlay: vi.fn(), onDevAvailabilityChanged: availability }
    )
    try {
      await view.mount(initial)
      expect(view.devAvailability).toEqual({ retire: false, scores: false })
      await view.runDevCommand({ type: 'arena:set-score', counter: 'wins', value: 5 })
      expect(devSetScore).not.toHaveBeenCalled()
      await view.mount(ready)
      expect(view.devAvailability).toEqual({ retire: true, scores: true })
      const saving = view.runDevCommand({
        type: 'arena:set-score',
        counter: 'wins',
        value: 5
      })
      expect(view.devAvailability).toEqual({ retire: false, scores: false })
      await view.runDevCommand({ type: 'arena:set-score', counter: 'wins', value: 6 })
      expect(devSetScore).toHaveBeenCalledTimes(1)
      expect(devSetScore).toHaveBeenCalledWith({
        runId: ready.runId,
        counter: 'wins',
        value: 5
      })
      completeSave({ ...ready, wins: 5, gamesPlayed: 5 })
      await saving
      expect(view.devAvailability).toEqual({ retire: true, scores: true })
      await view.runDevCommand({ type: 'arena:retire' })
      expect(view.getChildByLabel('arena.retire-dialog')!.visible).toBe(true)
      expect(retire).not.toHaveBeenCalled()
      expect(view.devAvailability).toEqual({ retire: false, scores: false })
      view
        .getChildByLabel('arena.retire-cancel', true)!
        .emit('pointertap', { button: 0 } as FederatedPointerEvent)
      expect(view.devAvailability).toEqual({ retire: true, scores: true })
      await view.mount({ ...ready, wins: 12, gamesPlayed: 12 })
      await view.runDevCommand({ type: 'arena:retire' })
      expect(retire).toHaveBeenCalledWith(ready.runId)
      for (let i = 0; i < 8; i++) await Promise.resolve()
      expect(view.devAvailability).toEqual({ retire: false, scores: false })
      expect(availability).toHaveBeenCalledWith({ retire: false, scores: false })
    } finally {
      view.dispose()
      artwork.mockRestore()
      width.mockRestore()
      height.mockRestore()
      canvas.mockRestore()
    }
  })
})
