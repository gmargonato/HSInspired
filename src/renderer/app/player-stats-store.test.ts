import { describe, expect, it } from 'vitest'
import { asClassId, type DeckClass } from '../../game/content/cards'
import {
  createEmptyClassWinTotals,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import { PersistentPlayerStatsStore } from './player-stats-store'
import { PersistentProgressionStore } from './progression-store'
import type { ProgressionApi, ProgressionSnapshot } from '../../shared/ipc/progression'
import { isPurchasedPremium, setPremiumCardIds } from '../rendering/premium-appearance'

describe('PersistentPlayerStatsStore', () => {
  it('loads once and updates its cached total after recording a win', async () => {
    let getCalls = 0
    let snapshot: PlayerStatsSnapshot = {
      winsByClass: { ...createEmptyClassWinTotals(), Mage: 7 },
      tavernBrawlWins: 2
    }
    const api: PlayerStatsApi = {
      get: async () => {
        getCalls += 1
        return snapshot
      },
      recordWin: async (classId) => {
        const key = classId as DeckClass
        snapshot = {
          ...snapshot,
          winsByClass: {
            ...snapshot.winsByClass,
            [key]: snapshot.winsByClass[key] + 1
          }
        }
        return snapshot
      },
      recordTavernBrawlWin: async () => {
        snapshot = {
          ...snapshot,
          tavernBrawlWins: snapshot.tavernBrawlWins + 1
        }
        return snapshot
      }
    }
    const store = new PersistentPlayerStatsStore(() => api)

    await Promise.all([store.load(), store.load()])
    expect(store.getWins(asClassId('Mage'))).toBe(7)
    expect(await store.recordWin(asClassId('Mage'))).toBe(8)
    expect(store.getWins(asClassId('Mage'))).toBe(8)
    expect(await store.recordTavernBrawlWin()).toBe(3)
    expect(store.getTavernBrawlWins()).toBe(3)
    expect(getCalls).toBe(1)
  })
})

describe('PersistentProgressionStore', () => {
  it('publishes dev dust changes and rejects the command when the production bridge omits it', async () => {
    const initial = { dust: 25, premiumPurchases: { basic_fireball: 50 } }
    const api: ProgressionApi = {
      get: async () => initial,
      reward: async () => ({ snapshot: initial, earned: 0 }),
      upgrade: async () => initial,
      refund: async () => initial,
      devSetDust: async (dust) => ({ ...initial, dust })
    }
    const store = new PersistentProgressionStore(() => api)
    try {
      expect(await store.setDust(1875)).toEqual({ ...initial, dust: 1875 })
      expect(isPurchasedPremium('basic_fireball')).toBe(true)
      delete api.devSetDust
      await expect(store.setDust(0)).rejects.toThrow('only in development')
      expect(store.getSnapshot().dust).toBe(1875)
    } finally {
      setPremiumCardIds([])
    }
  })
  it('loads saved ownership, publishes successful purchases, and keeps caller snapshots independent', async () => {
    let saved: ProgressionSnapshot = { dust: 50, premiumPurchases: {} }
    let getCalls = 0
    const api: ProgressionApi = {
      get: async () => {
        getCalls++
        return saved
      },
      reward: async () => ({ snapshot: saved, earned: 0 }),
      upgrade: async (cardId) => {
        saved = { dust: 0, premiumPurchases: { [cardId]: 50 } }
        return saved
      },
      refund: async () => {
        throw new Error('disk full')
      }
    }
    const store = new PersistentProgressionStore(() => api)
    let notifications = 0
    const unsubscribe = store.subscribe(() => notifications++)
    try {
      await Promise.all([store.load(), store.load()])
      expect(getCalls).toBe(1)
      await store.upgrade('basic_fireball')
      expect(isPurchasedPremium('basic_fireball')).toBe(true)
      expect(store.getSnapshot()).toEqual(saved)
      const copy = store.getSnapshot()
      ;(copy.premiumPurchases as Record<string, number>).basic_fireball = 999
      expect(store.getSnapshot().premiumPurchases.basic_fireball).toBe(50)
      await expect(store.refund('basic_fireball')).rejects.toThrow('disk full')
      expect(store.getSnapshot()).toEqual(saved)
      expect(notifications).toBe(2)
    } finally {
      unsubscribe()
      setPremiumCardIds([])
    }
  })
})
