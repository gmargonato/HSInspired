import type { OpeningMatchEvent, OpeningMatchState } from '../../../game/match'

interface CardAppearanceIdentity {
  readonly instanceId: string
  readonly cardId: string
  readonly ownerId?: string
  readonly controllerId?: string
}

/** Match-local cosmetics. No currency or visual state enters the deterministic engine. */
export class MatchPremiumAppearance {
  private readonly premiumStartingDecks = new Set<string>()

  private identityPremium(cardId: string, ownerId: string): boolean {
    return (
      ownerId === this.localPlayer() &&
      (this.purchased(cardId) ||
        (cardId === 'basic_the_coin' && this.premiumStartingDecks.has(ownerId)))
    )
  }

  setStartingDeck(
    participantId: string,
    cards: Readonly<Record<string, number>>
  ): void {
    const entries = Object.entries(cards).filter(([, count]) => count > 0)
    if (
      participantId === this.localPlayer() &&
      entries.length > 0 &&
      entries.every(([id]) => this.purchased(id))
    )
      this.premiumStartingDecks.add(participantId)
    else this.premiumStartingDecks.delete(participantId)
  }
  private readonly instances = new Map<
    string,
    { cardId: string; ownerId: string; premium: boolean }
  >()

  constructor(
    private readonly localPlayer: () => string,
    private readonly purchased: (cardId: string) => boolean
  ) {}

  inherit(
    card: CardAppearanceIdentity,
    sourceId: string,
    participantId = this.localPlayer()
  ): boolean {
    if (!this.instances.has(card.instanceId)) {
      this.instances.set(card.instanceId, {
        cardId: card.cardId,
        ownerId: participantId,
        premium:
          this.instances.get(sourceId)?.premium === true ||
          this.identityPremium(card.cardId, participantId)
      })
    }
    return this.resolve(card, participantId)
  }

  resolve(card: CardAppearanceIdentity, participantId = this.localPlayer()): boolean {
    const previous = this.instances.get(card.instanceId)
    if (previous) {
      if (previous.cardId !== card.cardId) {
        previous.cardId = card.cardId
        previous.premium ||= this.identityPremium(card.cardId, previous.ownerId)
      }
      return previous.premium
    }
    const ownerId = card.ownerId ?? card.controllerId ?? participantId
    const premium = this.identityPremium(card.cardId, ownerId)
    this.instances.set(card.instanceId, { cardId: card.cardId, ownerId, premium })
    return premium
  }

  sideFor(
    card: Pick<CardAppearanceIdentity, 'instanceId' | 'ownerId' | 'controllerId'>,
    participantId = this.localPlayer()
  ): 'local' | 'remote' {
    const ownerId =
      this.instances.get(card.instanceId)?.ownerId ??
      card.ownerId ??
      card.controllerId ??
      participantId
    return ownerId === this.localPlayer() ? 'local' : 'remote'
  }

  rememberState(state: OpeningMatchState): void {
    this.observe(state.openingHistory ?? [])
    for (const player of state.players) {
      for (const card of [
        ...player.deck,
        ...player.hand,
        ...player.board,
        ...(player.graveyard ?? []).map((entry) => entry.minion),
        ...(player.weapon ? [player.weapon] : []),
        ...(player.secrets ?? [])
      ]) {
        this.resolve(card, player.participantId)
      }
    }
  }

  observe(events: readonly OpeningMatchEvent[]): void {
    for (const event of events) {
      // Opening triggers (e.g. Malchezaar) provide history rather than effect cues.
      if (event.type === 'history-action-resolved' && event.source.cardId) {
        this.resolve(
          {
            instanceId: event.source.id,
            cardId: event.source.cardId,
            ownerId: event.source.ownerId
          },
          event.source.participantId
        )
        for (const outcome of event.outcomes) {
          if (outcome.kind !== 'shuffle-deck' || !outcome.target.cardId) continue
          this.inherit(
            { instanceId: outcome.target.id, cardId: outcome.target.cardId },
            event.source.id,
            outcome.target.participantId
          )
        }
      }
      if (event.type !== 'effect-resolved') continue
      const data = event.data
      if (!data) continue
      const sourceId =
        typeof data.creationSourceInstanceId === 'string'
          ? data.creationSourceInstanceId
          : event.sourceInstanceId
      const sourcePremium =
        this.instances.get(sourceId)?.premium ??
        (sourceId === event.sourceInstanceId &&
          event.sourceCardId !== null &&
          this.resolve(
            { instanceId: sourceId, cardId: event.sourceCardId },
            event.controllerId
          ))
      const participantId =
        typeof data.participantId === 'string' ? data.participantId : event.controllerId
      const inherit = (instanceId: unknown, cardId: unknown): void => {
        if (typeof instanceId !== 'string' || typeof cardId !== 'string') return
        // Moving or replaying an existing instance never changes its appearance.
        if (this.instances.has(instanceId)) return
        const premium =
          Boolean(sourcePremium) || this.identityPremium(cardId, participantId)
        this.instances.set(instanceId, { cardId, ownerId: participantId, premium })
      }
      if (
        [
          'add-to-hand',
          'summon',
          'equip',
          'copy',
          'shuffle-into-deck',
          'shuffle-dead-cthun',
          'cast-spell'
        ].includes(event.action)
      ) {
        inherit(data.instanceId, data.cardId)
      }
      if (
        event.action === 'discover' &&
        Array.isArray(data.instanceIds) &&
        Array.isArray(data.cardIds)
      ) {
        data.instanceIds.forEach((id, index) =>
          inherit(id, (data.cardIds as unknown[])[index])
        )
      }
      if (
        event.action === 'transform' &&
        typeof data.target === 'string' &&
        typeof data.cardId === 'string'
      ) {
        this.resolve({ instanceId: data.target, cardId: data.cardId }, participantId)
      }
    }
  }
}
