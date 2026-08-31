import { describe, expect, it } from 'vitest'
import { asClassId, type DeckClass } from '../../game/content/cards'
import {
  createEmptyClassWinTotals,
  type PlayerStatsApi,
  type PlayerStatsSnapshot
} from '../../shared/ipc/player-stats'
import { PersistentPlayerStatsStore } from './player-stats-store'

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
