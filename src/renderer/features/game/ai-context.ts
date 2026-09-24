import { compactAiFacts, mechanicsText } from './ai-compact-context'
import { CARD_CATALOG } from '../../../game/content/cards'
import { HERO_POWER_CATALOG } from '../../../game/content/hero-powers'
import { canonicalCommandKey } from '../../../game/match/ai'
import { temporaryManaAfterGain } from '../../../game/match/effects/mana-actions'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords,
  hasBoardMinionEntryExhaustion,
  isBoardMinionSleeping
} from '../../../game/match/rules/minion-attack-state'
import type { PlayerId, TurnMatchCommand } from '../../../game/match'
import type { AiMessage, JsonObject } from '../../../shared/ipc/ai'
import type { GameBoardSession } from './game-board-session'
import { aiActionIntent } from './ai-action-intent'
import { AI_MULLIGAN_INSTRUCTION, AI_STRATEGY_INSTRUCTION } from './ai-prompts'

export function aiJson(value: unknown): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject
}

export function cardFacts(cardId: string): JsonObject {
  const card = CARD_CATALOG.require(cardId)
  return aiJson({
    name: card.name,
    type: card.type,
    cost: card.cost,
    ...((card.tribes?.length ?? 0) > 0 || card.subtype
      ? {
          tribes: [
            ...new Set(
              [...(card.tribes ?? []), card.subtype].filter((tribe): tribe is string =>
                Boolean(tribe)
              )
            )
          ]
        }
      : {}),
    ...('attack' in card ? { attack: card.attack } : {}),
    ...('health' in card ? { health: card.health } : {}),
    ...('durability' in card ? { durability: card.durability } : {}),
    ...('armor' in card ? { armor: card.armor } : {}),
    ...(card.keywords.length ? { keywords: card.keywords } : {}),
    text: card.rulesText,
    ...(card.rarity === 'Legendary' ? { legendary: true } : {}),
    ...(card.effects.length
      ? { implementedMechanics: mechanicsText(compactAiFacts(card.effects)) }
      : {})
  })
}

function cardNameCounts(cardIds: readonly string[]): JsonObject {
  const counts = new Map<string, number>()
  for (const cardId of cardIds) {
    const name = CARD_CATALOG.require(cardId).name
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)))
}

function heroCardDeckFacts(deck: {
  readonly cards: readonly { readonly cardId: string; readonly count: number }[]
}): JsonObject[] {
  return deck.cards
    .filter(({ cardId }) => CARD_CATALOG.require(cardId).type === 'Hero')
    .map(({ cardId, count }) => ({
      cardId,
      originalCount: count,
      ...cardFacts(cardId)
    }))
}

function countCards(
  cards: readonly { readonly cardId: string }[],
  cardId: string
): number {
  return cards.filter((card) => card.cardId === cardId).length
}

function ownHeroCardFacts(
  originalDeck: {
    readonly cards: readonly { readonly cardId: string; readonly count: number }[]
  },
  currentDeck: readonly { readonly cardId: string }[],
  hand: readonly { readonly cardId: string }[],
  graveyardCardIds: readonly string[]
): JsonObject[] {
  return heroCardDeckFacts(originalDeck).map((card) => {
    const cardId = String(card.cardId)
    return {
      ...card,
      locations: {
        deck: countCards(currentDeck, cardId),
        hand: countCards(hand, cardId),
        graveyard: graveyardCardIds.filter((entry) => entry === cardId).length
      }
    }
  })
}

function positiveTraits(value: {
  readonly keywords?: readonly string[]
  readonly silenced?: boolean
  readonly frozenUntilTurn?: number | null
  readonly divineShield?: boolean
  readonly stealth?: boolean
  readonly immune?: boolean
  readonly spellImmune?: boolean
}): string[] {
  return [
    ...(value.silenced ? ['Silenced'] : []),
    ...(value.frozenUntilTurn !== null && value.frozenUntilTurn !== undefined
      ? ['Frozen']
      : []),
    ...(value.divineShield ? ['Divine Shield'] : []),
    ...(value.stealth ? ['Stealth'] : []),
    ...(value.immune ? ['Immune'] : []),
    ...(value.spellImmune ? ['Cannot be targeted by spells'] : [])
  ]
}

export function aiMulliganSystemContext(session: GameBoardSession): AiMessage {
  const deck = session.getAiObservation().selfOriginalDeck
  return {
    role: 'system',
    content:
      AI_MULLIGAN_INSTRUCTION +
      '\n' +
      'The second player receives The Coin. Replacement draws are unknown; evaluate only the visible hand.\n' +
      JSON.stringify({
        ...(session.opponentStrategy
          ? { originalDeckStrategy: session.opponentStrategy }
          : {}),
        deck: {
          heroId: deck.heroId,
          cards: cardNameCounts(
            deck.cards.flatMap(({ cardId, count }) => Array<string>(count).fill(cardId))
          )
        }
      })
  }
}

/** Opening mulligan uses only hand, deck size and player order — not the full board snapshot. */
export function aiMulliganModelState(session: GameBoardSession): JsonObject {
  const observation = session.getAiObservation()
  const self = observation.players.find((player) => player.role === 'self')
  const opponent = observation.players.find((player) => player.role === 'opponent')
  if (!self || !opponent) throw new Error('Mulligan facts require self and opponent.')
  return compactAiFacts({
    phase: 'mulligan',
    self: {
      playerNumber: self.playerNumber,
      heroId: self.heroId,
      deckSize: self.deckSize,
      hand: self.hand.map((card) => ({
        ref: card.instanceId,
        ...cardFacts(card.cardId),
        ...(card.currentCost !== null ? { cost: card.currentCost } : {})
      }))
    },
    opponent: { handSize: opponent.handSize }
  })
}

export function aiSystemContext(session: GameBoardSession): AiMessage {
  const deck = session.getAiObservation().selfOriginalDeck
  return {
    role: 'system',
    content:
      AI_STRATEGY_INSTRUCTION +
      '\n' +
      'Missing collections are empty; omitted inactive flags are false and omitted ordinary counters are zero. Normal limits are 10 cards in hand, 7 minions, and 10 mana. fatigueDamage is the next empty-deck draw damage; it increases after each such draw. The second player receives The Coin.\n' +
      'Board positions are zero-based, left to right. Insertion slot 0 is before the first minion; slot N is after N minions. Grouped positions map slot to action ID; select that ID. canAttackNow and canAttackHeroNow reflect current legal attacks. attacksRemaining is an allowance, not permission to attack. A stat buff alone does not remove summoning sickness or restore attacks.\n' +
      'An opponent restriction of not your turn does not imply they cannot attack on their next turn. Read the relevant restrictions and turn transition.\n' +
      'Board printedText and printedKeywords describe the original card, not active abilities. activeKeywords and currentStatus describe the current minion. Attack, health, cost and durability are current values with stat modifiers already applied; never add enchantment deltas again. Enchantment details explain sources and expiry, not extra stats.\n' +
      'battlecryConditions evaluate only the stated requirement using your current hand after excluding the card being played. met does not guarantee an effect or target; not-met means do not expect that conditional effect unless the hand changes first. unknown is not confirmation. Intervening effects may change these facts. An inactive battlecry minion can still be a legal body-only play. Quest state is public and appears under each player as quest, including its progress, target, objective card and reward. Your original deck also lists your Hero Cards under deck.heroCards; their current deck, hand and graveyard counts appear under their locations.\n' +
      JSON.stringify({
        ...(session.opponentStrategy
          ? { originalDeckStrategy: session.opponentStrategy }
          : {}),
        deck: {
          ...deck,
          cards: cardNameCounts(
            deck.cards.flatMap(({ cardId, count }) => Array<string>(count).fill(cardId))
          ),
          heroCards: heroCardDeckFacts(deck)
        }
      })
  }
}

export function aiActions(
  session: GameBoardSession,
  commands: readonly TurnMatchCommand[],
  perspectiveParticipantId: PlayerId = session.remoteParticipantId
) {
  const state = session.getState()
  const self = session.findPlayer(state, perspectiveParticipantId)
  const opponentId = state.players.find(
    (player) => player.participantId !== perspectiveParticipantId
  )!.participantId
  const names = new Map<string, string>()
  for (const player of session.getAiObservation(perspectiveParticipantId).players) {
    for (const card of [...player.hand, ...player.board])
      names.set(card.instanceId, CARD_CATALOG.require(card.cardId).name)
  }
  for (const card of state.pendingDiscover?.candidates ?? [])
    names.set(card.instanceId, CARD_CATALOG.require(card.cardId).name)
  const describe = (value: unknown): string => {
    if (typeof value === 'string')
      return names.has(value) ? names.get(value) + ' [' + value + ']' : value
    if (Array.isArray(value)) return value.map(describe).join(', ')
    if (value && typeof value === 'object')
      return Object.entries(value)
        .map(([key, v]) => key + '=' + describe(v))
        .join('; ')
    return String(value)
  }
  return commands.map((command, index) => {
    if (command.type === 'confirm-mulligan') {
      const replace = new Set(command.replaceInstanceIds)
      return {
        id: 'a' + index,
        intent: aiJson(aiActionIntent(command, opponentId)),
        description:
          'confirm-mulligan: KEEP ' +
          (self.hand
            .filter((card) => !replace.has(card.instanceId))
            .map((card) => describe(card.instanceId))
            .join(', ') || 'none') +
          '; REPLACE ' +
          (self.hand
            .filter((card) => replace.has(card.instanceId))
            .map((card) => describe(card.instanceId))
            .join(', ') || 'none'),
        command
      }
    }
    const card =
      'cardInstanceId' in command
        ? [...self.hand, ...(state.pendingDiscover?.candidates ?? [])].find(
            (c) => c.instanceId === command.cardInstanceId
          )
        : undefined
    const option =
      command.type === 'choose-card-option'
        ? state.pendingCardChoice?.options.find((o) => o.choice === command.choice)
            ?.label
        : undefined
    let manaHint = ''
    if (command.type === 'play-card' && card?.cardId === 'basic_the_coin') {
      const input = session.match.getPlayInput?.(
        perspectiveParticipantId,
        card.instanceId
      )
      const gain = CARD_CATALOG.require(card.cardId)
        .effects.filter((effect) => effect.trigger === 'cast')
        .flatMap((effect) => effect.actions ?? [])
        .find(
          (action) =>
            action.action === 'gain-mana' &&
            action.player === 'self' &&
            action.duration === 'this-turn'
        )
      if (input && gain && 'amount' in gain && typeof gain.amount === 'number') {
        const after = temporaryManaAfterGain(
          { ...self.mana, available: self.mana.available - input.currentCost },
          gain.amount
        )
        manaHint = `; available mana ${self.mana.available} → ${after.available} after paying ${input.currentCost} and resolving Coin's mana effect (before other triggers)`
      }
    }
    const title = [
      command.type,
      card ? CARD_CATALOG.require(card.cardId).name : '',
      option ?? ''
    ]
      .filter(Boolean)
      .join(': ')
    return {
      id: 'a' + index,
      intent: aiJson(aiActionIntent(command, opponentId)),
      // Intent carries the references once in model inputs; logs retain the full description.
      summary: title + manaHint,
      description:
        title +
        ' (' +
        describe(
          Object.fromEntries(
            Object.entries(command).filter(
              ([key]) => key !== 'type' && key !== 'participantId'
            )
          )
        ) +
        ')' +
        manaHint,
      command
    }
  })
}

/** Group only position variants; each position still selects its exact legal command. */
export function aiActionFacts(actions: ReturnType<typeof aiActions>): JsonObject[] {
  const result: JsonObject[] = []
  const groups = new Map<
    string,
    { move: string; intent: JsonObject; positions: Record<string, string> }
  >()
  for (const action of actions) {
    const command = action.command
    if (command.type !== 'play-card' || command.position === undefined) {
      result.push({
        id: action.id,
        move: action.summary ?? action.description,
        intent: action.intent
      })
      continue
    }
    const key = canonicalCommandKey({ ...command, position: undefined })
    let group = groups.get(key)
    if (!group) {
      group = {
        move:
          action.summary ?? action.description.replace(/; position=\d+(?=[;)])/, ''),
        intent: { ...action.intent, position: null },
        positions: {}
      }
      groups.set(key, group)
      result.push(group)
    }
    group.positions[String(command.position)] = action.id
    const slots = Object.keys(group.positions)
    group.intent = {
      ...group.intent,
      position: slots.length === 1 ? (command.position ?? null) : null
    }
  }
  return result
}

/** Only fair projections and explicitly selected public mechanics cross the API boundary. */
export function aiModelState(
  session: GameBoardSession,
  commands: readonly TurnMatchCommand[]
): JsonObject {
  const { selfOriginalDeck, ...observation } = session.getAiObservation()
  const state = session.getState()
  const selfId = session.remoteParticipantId
  const selfState = session.findPlayer(state, selfId)
  const discover =
    state.pendingDiscover?.participantId === selfId ? state.pendingDiscover : undefined
  const choice =
    state.pendingCardChoice?.participantId === selfId
      ? state.pendingCardChoice
      : undefined
  return compactAiFacts({
    turn: observation.turnNumber,
    remainingDeck: cardNameCounts(
      session.findPlayer(state, selfId).deck.map((card) => card.cardId)
    ),
    players: observation.players.map((player) => {
      const heroPower = HERO_POWER_CATALOG.require(player.heroPower.id)
      return {
        role: player.role,
        heroId: player.heroId,
        hero: {
          ...player.hero,
          missingHealth: Math.max(0, player.hero.maxHealth - player.hero.health),
          combat: {
            effectiveAttack:
              Math.max(0, player.hero.attack) + (player.weapon?.attack ?? 0),
            canAttackNow: commands.some(
              (command) =>
                command.type === 'attack-character' &&
                command.participantId === player.participantId &&
                command.attacker.kind === 'hero'
            ),
            canAttackHeroNow: commands.some(
              (command) =>
                command.type === 'attack-character' &&
                command.participantId === player.participantId &&
                command.attacker.kind === 'hero' &&
                command.defender.kind === 'hero'
            ),
            availabilityScope:
              'Current legal attacks only; opponent readiness changes on their turn.'
          }
        },
        quest: player.quest
          ? {
              cardId: player.quest.cardId,
              card: cardFacts(player.quest.cardId),
              rewardCardId: player.quest.rewardCardId,
              reward: cardFacts(player.quest.rewardCardId),
              goal: player.quest.goal,
              progress: player.quest.progress,
              target: player.quest.target,
              completed: player.quest.progress >= player.quest.target
            }
          : null,
        ...(player.role === 'self'
          ? {
              heroCards: ownHeroCardFacts(
                selfOriginalDeck,
                selfState.deck,
                player.hand,
                player.graveyardCardIds
              )
            }
          : {}),
        hand: player.hand.map((card) => ({
          ref: card.instanceId,
          ...cardFacts(card.cardId),
          ...(player.role === 'self'
            ? {
                battlecryConditions: session.match.getPlayInput?.(
                  selfId,
                  card.instanceId
                )?.battlecryConditions
              }
            : {}),
          ...(card.currentCost !== null ? { cost: card.currentCost } : {}),
          ...(card.currentCost !== null &&
          card.baseCost !== null &&
          card.currentCost !== card.baseCost
            ? { baseCost: card.baseCost }
            : {}),
          ...(typeof card.modifications?.attack === 'number'
            ? { attack: card.modifications.attack }
            : {}),
          ...(typeof card.modifications?.health === 'number'
            ? { health: card.modifications.health }
            : {}),
          ...(card.modifications?.enchantments?.length
            ? { activeEnchantments: card.modifications.enchantments }
            : {})
        })),
        handSize: player.handSize,
        deckSize: player.deckSize,
        board: player.board.map((minion, position) => {
          const keywords = effectiveBoardMinionKeywords(minion, observation.turnNumber)
          const remaining = Math.max(
            0,
            (minion.maxAttacksPerTurn ??
              (keywords.includes('mega-windfury')
                ? 4
                : keywords.includes('windfury')
                  ? 2
                  : 1)) - boardMinionAttacksUsed(minion, observation.turnNumber)
          )
          const attacks = commands.filter(
            (command) =>
              command.type === 'attack-character' &&
              command.participantId === player.participantId &&
              command.attacker.kind === 'minion' &&
              command.attacker.instanceId === minion.instanceId
          )
          const restrictions = [
            ...(observation.activePlayerId !== player.participantId
              ? ['not your turn']
              : []),
            ...(isBoardMinionSleeping(minion, observation.turnNumber)
              ? ['summoning sickness or control changed this turn']
              : []),
            ...((minion.frozenUntilTurn ?? -1) >= observation.turnNumber
              ? ['frozen']
              : []),
            ...(keywords.includes('cannot-attack') ? ['cannot attack'] : []),
            ...(minion.attack <= 0 ? ['zero attack'] : []),
            ...(remaining === 0 ? ['attacks exhausted'] : []),
            ...(keywords.includes('cannot-attack-heroes') ||
            (keywords.includes('rush') &&
              !keywords.includes('charge') &&
              hasBoardMinionEntryExhaustion(minion, observation.turnNumber))
              ? ['cannot attack heroes']
              : [])
          ]
          return {
            ref: minion.instanceId,
            position,
            ...cardFacts(minion.cardId),
            attack: minion.attack,
            health: minion.health,
            combat: {
              canAttackNow: attacks.length > 0,
              canAttackHeroNow: attacks.some(
                (command) =>
                  command.type === 'attack-character' &&
                  command.defender.kind === 'hero'
              ),
              attacksRemaining: remaining,
              restrictions
            },
            maxHealth: minion.maxHealth,
            missingHealth: Math.max(0, minion.maxHealth - minion.health),
            keywords: undefined,
            text: undefined,
            implementedMechanics: undefined,
            printedMechanics: CARD_CATALOG.require(minion.cardId).effects.length
              ? mechanicsText(
                  compactAiFacts(CARD_CATALOG.require(minion.cardId).effects)
                )
              : undefined,
            printedKeywords: CARD_CATALOG.require(minion.cardId).keywords,
            printedText: CARD_CATALOG.require(minion.cardId).rulesText,
            activeKeywords: keywords.filter(
              (keyword) =>
                (keyword !== 'divine-shield' || minion.divineShield === true) &&
                (keyword !== 'stealth' || minion.stealth === true)
            ),
            currentStatus: {
              shieldActive: minion.divineShield === true,
              stealthActive: minion.stealth === true,
              isSilenced: minion.silenced === true,
              traits: positiveTraits(minion)
            },
            ...((minion.enchantments?.length ?? 0) > 0 ||
            (minion.grantedTriggers?.length ?? 0) > 0 ||
            (minion.attachedEffects?.length ?? 0) > 0
              ? {
                  activeEffects: compactAiFacts({
                    enchantments: minion.enchantments,
                    grantedTriggers: minion.grantedTriggers,
                    attachedEffects: minion.attachedEffects
                  })
                }
              : {})
          }
        }),
        weapon: player.weapon
          ? {
              ref: player.weapon.instanceId,
              ...cardFacts(player.weapon.cardId),
              attack: player.weapon.attack,
              durability: player.weapon.durability,
              ...(player.weapon.maxDurability !== player.weapon.durability
                ? { maxDurability: player.weapon.maxDurability }
                : {}),
              ...(player.weapon.enchantments?.length
                ? { activeEnchantments: player.weapon.enchantments }
                : {})
            }
          : null,
        mana: player.mana,
        heroPower: {
          ref: `${player.participantId}:hero-power`,
          name: heroPower.displayName,
          cost: player.heroPower.cost,
          available: player.heroPower.available,
          text: heroPower.rulesText,
          targeting: heroPower.targeting
        },
        effects: player.effects,
        fatigueDamage: player.fatigueDamage,
        secrets: player.secrets.map((secret) =>
          secret.cardId
            ? { ref: secret.instanceId, ...cardFacts(secret.cardId) }
            : { unknown: true }
        ),
        graveyard: cardNameCounts(player.graveyardCardIds)
      }
    }),
    pendingDiscover: discover
      ? {
          candidates: discover.candidates.map((candidate) => ({
            ref: candidate.instanceId,
            ...cardFacts(candidate.cardId),
            ...(candidate.currentCost !== null ? { cost: candidate.currentCost } : {}),
            ...(candidate.attack !== undefined ? { attack: candidate.attack } : {}),
            ...(candidate.health !== undefined ? { health: candidate.health } : {}),
            ...(candidate.enchantments?.length
              ? { activeEnchantments: candidate.enchantments }
              : {})
          }))
        }
      : null,
    pendingChoice: choice
      ? {
          source: choice.sourceCardId
            ? CARD_CATALOG.require(choice.sourceCardId).name
            : undefined,
          options: choice.options.map((option) => ({
            ...option,
            ...(option.presentationCardId
              ? { card: cardFacts(option.presentationCardId) }
              : {}),
            ...(option.presentationHeroPowerId
              ? {
                  heroPower: (() => {
                    const power = HERO_POWER_CATALOG.require(
                      option.presentationHeroPowerId!
                    )
                    return {
                      name: power.displayName,
                      cost: power.cost,
                      text: power.rulesText,
                      targeting: power.targeting
                    }
                  })()
                }
              : {})
          })),
          resolution:
            choice.resolution?.type === 'kazakus-potion'
              ? {
                  type: choice.resolution.type,
                  stage: choice.resolution.stage,
                  cost: choice.resolution.selectedCostOption?.cost,
                  firstIngredient: choice.resolution.selectedFirstIngredient
                }
              : choice.resolution?.type
        }
      : null,
    scheduledEffects: (state.scheduledEffects ?? []).filter(
      (effect) =>
        effect.controllerId === selfId ||
        effect.source?.zone === 'board' ||
        effect.source?.zone === 'hero'
    )
  }) as JsonObject
}
