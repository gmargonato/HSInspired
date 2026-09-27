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
  /** Current per-participant hero-power premium, fed by replacement events. */
  private readonly heroPowers = new Map<string, boolean>()

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
        // A transform produces a fresh card: premium is re-derived from the
        // new identity instead of being inherited from the replaced card.
        previous.cardId = card.cardId
        previous.premium = this.identityPremium(card.cardId, previous.ownerId)
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

  /** Seeds the tracked hero-power premium before any replacement event. */
  setHeroPowerPremium(participantId: string, premium: boolean): void {
    this.heroPowers.set(participantId, premium)
  }

  /** Whether the participant's current hero power should render premium. */
  heroPowerPremium(participantId: string): boolean {
    return this.heroPowers.get(participantId) === true
  }

  /** Whether a tracked card instance renders premium; unknown means not. */
  instancePremium(instanceId: string): boolean {
    return this.instances.get(instanceId)?.premium === true
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
      if (event.type === 'hero-power-replaced' || event.type === 'hero-replaced') {
        // A hero card's battlecry (e.g. Lord Jaraxxus) also installs its power.
        const sourcePremium = event.sourceInstanceId
          ? this.instances.get(event.sourceInstanceId)?.premium === true
          : false
        const identityPremium =
          typeof event.sourceCardId === 'string'
            ? this.identityPremium(event.sourceCardId, event.participantId)
            : false
        this.heroPowers.set(event.participantId, sourcePremium || identityPremium)
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
        (event.action === 'transform' || event.action === 'transform-random') &&
        typeof data.target === 'string' &&
        typeof data.cardId === 'string'
      ) {
        // Transforms mutate the instance in place but produce a fresh card:
        // the result is premium only when the transforming source itself is
        // premium, never inherited from the replaced card or from owned
        // premium copies of the rolled card.
        const previous = this.instances.get(data.target)
        this.instances.set(data.target, {
          cardId: data.cardId,
          ownerId: previous?.ownerId ?? participantId,
          premium: Boolean(sourcePremium)
        })
      }
    }
  }
}
