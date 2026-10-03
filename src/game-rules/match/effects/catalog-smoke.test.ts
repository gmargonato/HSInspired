import { describe, expect, it } from 'vitest'
import { CARD_CATALOG } from '../../content/cards'
import { runCatalogCardScenario } from '../testing/card-testing-scenario'

describe('catalog effect closure smoke', () => {
  it('resolves every live playable card deterministically through gameplay commands', () => {
    for (const [index, card] of CARD_CATALOG.all.entries()) {
      // Quests are tested through their opening-objective entry path by the campaign runner.
      if (card.type === 'Spell' && card.quest) continue
      const seed = 0x5000 + index
      const firstAttempt = runCatalogCardScenario({
        cardId: card.id,
        seed,
        actor: 'first'
      })
      expect(runCatalogCardScenario({ cardId: card.id, seed, actor: 'first' })).toEqual(
        firstAttempt
      )
      if (!firstAttempt.result?.accepted)
        throw new Error(
          card.id +
            ': ' +
            (firstAttempt.result?.code ?? 'no-result') +
            ' ' +
            (firstAttempt.result?.message ?? '')
        )
      if (firstAttempt.invariantError)
        throw new Error(card.id + ': ' + firstAttempt.invariantError)
    }
  }, 180_000)
})
