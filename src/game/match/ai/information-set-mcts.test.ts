import { describe, expect, it } from 'vitest'
import {
  InformationSetMcts,
  mctsRootRecommendationScore
} from './information-set-mcts'

describe('information-set Monte Carlo tree search', () => {
  it('expands alternatives and backs up root-perspective outcomes', () => {
    const tree = new InformationSetMcts<string>()
    const actions = [
      { key: 'safe', action: 'safe', prior: 2 },
      { key: 'winning', action: 'winning', prior: 1 },
      { key: 'bad', action: 'bad', prior: 0 }
    ] as const
    const root = 'same-visible-position'

    for (let iteration = 0; iteration < 80; iteration++) {
      const selected = tree.select(root, actions, true)
      expect(selected).not.toBeNull()
      const value = selected!.candidate.action === 'winning' ? 1 : -0.5
      tree.backup([selected!], value)
    }

    const stats = tree.rootStats(root)
    expect(new Set(stats.map(({ key }) => key))).toEqual(
      new Set(['safe', 'winning', 'bad'])
    )
    expect(stats[0]?.key).toBe('winning')
    expect(stats[0]?.meanValue).toBe(1)
  })

  it('lets an opponent node minimize root-perspective value', () => {
    const tree = new InformationSetMcts<string>()
    const node = 'opponent-visible-position'
    const actions = [
      { key: 'helps-root', action: 'helps-root', prior: 1 },
      { key: 'hurts-root', action: 'hurts-root', prior: 1 }
    ] as const
    const first = tree.select(node, actions, true)!
    tree.backup([first], first.candidate.action === 'helps-root' ? 1 : -1)
    const second = tree.select(node, actions, true)!
    tree.backup([second], second.candidate.action === 'helps-root' ? 1 : -1)

    for (let iteration = 0; iteration < 12; iteration++) {
      const selected = tree.select(node, actions, false)
      expect(selected?.candidate.action).toBe('hurts-root')
      tree.backup([selected!], -1)
    }
  })

  it('covers the configured root action width before repeating a candidate', () => {
    const tree = new InformationSetMcts<string>()
    const actions = ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      action: key,
      prior: 0
    }))

    for (let iteration = 0; iteration < actions.length; iteration++) {
      const selected = tree.select('wide-root', actions, true, actions.length)
      expect(selected).not.toBeNull()
      tree.backup([selected!], 0.25)
    }

    expect(tree.rootStats('wide-root').map(({ visits }) => visits)).toEqual([
      1, 1, 1, 1
    ])
  })

  it('does not let one lucky rollout overrule a repeatedly supported root action', () => {
    const luckyTerminalWin = { visits: 1, meanValue: 1 }
    const repeatedlyGoodLine = { visits: 20, meanValue: 0.9 }

    expect(mctsRootRecommendationScore(repeatedlyGoodLine)).toBeGreaterThan(
      mctsRootRecommendationScore(luckyTerminalWin)
    )
  })
})
