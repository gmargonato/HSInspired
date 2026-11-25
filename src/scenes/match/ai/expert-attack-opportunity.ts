import { CARD_CATALOG } from '../../../game-rules/content'
import {
  enumerateLegalCommands,
  type OpeningMatchCheckpoint,
  type PlayerId,
  type TurnMatchCommand
} from '../../../game-rules/match'
import { createFairHypothesisCheckpoint } from '../../../game-rules/match/ai/fair-hypothesis-checkpoint'
import { revealsTacticalInformation } from '../../../game-rules/match/ai/tactical-search'
import { createOpeningMatchFromCheckpoint } from '../../../game-rules/match/opening-match'
import { effectiveBoardMinionKeywords } from '../../../game-rules/match/rules/minion-attack-state'

export const EXPERT_ATTACK_OPPORTUNITY_MAX_DISPATCHES = 192
export const EXPERT_ATTACK_OPPORTUNITY_MAX_MS = 50

/** Local tactical preferences, not proofs about unknown hands or future draws. */
export function reviewAttackOpportunity(
  checkpoint: OpeningMatchCheckpoint,
  actorId: PlayerId,
  selected: TurnMatchCommand,
  shouldStop: () => boolean = () => false,
  now: () => number = () => performance.now()
) {
  const started = now()
  const stats = { dispatches: 0, abstained: false, durationMs: 0 }
  const unchanged = () => ({ commands: null, reason: null, stats })
  const stop = () =>
    shouldStop() ||
    stats.dispatches >= EXPERT_ATTACK_OPPORTUNITY_MAX_DISPATCHES ||
    !Number.isFinite(now()) ||
    now() - started >= EXPERT_ATTACK_OPPORTUNITY_MAX_MS
  const state = checkpoint.state
  if (
    !Number.isFinite(started) ||
    selected.participantId !== actorId ||
    state.phase !== 'turns' ||
    state.activePlayerId !== actorId ||
    state.pendingDiscover ||
    state.pendingCardChoice ||
    state.pendingResolution ||
    state.scheduledEffects?.length ||
    state.players.some((player) => player.secrets?.length || player.quest)
  )
    return unchanged()
  const own = state.players.find((p) => p.participantId === actorId)!
  const enemy = state.players.find((p) => p.participantId !== actorId)!
  const damageDrawSources = new Set(
    enemy.board
      .filter(
        (m) =>
          !m.silenced &&
          CARD_CATALOG.require(m.cardId).effects.every(
            (effect) =>
              effect.trigger === 'on-damage' &&
              (effect.event?.target as { selection?: string } | undefined)
                ?.selection === 'source' &&
              effect.actions?.length === 1 &&
              effect.actions[0]?.action === 'draw' &&
              effect.actions[0].player === 'self' &&
              effect.actions[0].count === 1
          )
      )
      .map((m) => m.instanceId)
  )
  // A supported face attack cannot activate these effects. Combat branches
  // additionally reject triggered events and any change to the random stream.
  if (
    state.players.some(
      (p) =>
        p.hero.enchantments?.length ||
        (p.weapon &&
          (p.weapon.enchantments?.length ||
            CARD_CATALOG.require(p.weapon.cardId).effects.length)) ||
        p.board.some(
          (m) =>
            m.grantedTriggers?.length ||
            m.attachedEffects?.length ||
            m.enchantments?.length ||
            (!m.silenced &&
              CARD_CATALOG.require(m.cardId).effects.some(
                (effect) =>
                  ![
                    'battlecry',
                    'on-play',
                    'deathrattle',
                    'while-in-deck',
                    'while-in-hand'
                  ].includes(effect.trigger) &&
                  !damageDrawSources.has(m.instanceId) &&
                  !(
                    effect.trigger === 'aura' &&
                    effect.actions?.every(
                      (action) =>
                        ['modify', 'grant-keyword'].includes(action.action) &&
                        (action.target as { selection?: string } | null)?.selection ===
                          'source' &&
                        (action.target as { type?: string } | null)?.type === 'minion'
                    )
                  )
              ))
        )
    )
  )
    return unchanged()
  const card =
    selected.type === 'play-card'
      ? own.hand.find((c) => c.instanceId === selected.cardInstanceId)
      : undefined
  const returnsMinions =
    card &&
    JSON.stringify(CARD_CATALOG.require(card.cardId).effects).includes(
      '"return-to-hand"'
    )
  const refresh =
    !!own.weapon &&
    (selected.type === 'use-hero-power' ||
      (card && CARD_CATALOG.require(card.cardId).type === 'Weapon'))
  if (
    !returnsMinions &&
    !refresh &&
    selected.type !== 'end-turn' &&
    selected.type !== 'attack-character'
  )
    return unchanged()
  if (stop()) {
    stats.abstained = true
    return unchanged()
  }
  const fair = createFairHypothesisCheckpoint(checkpoint, actorId, 0x71ac71c)
  const make = () =>
    createOpeningMatchFromCheckpoint({
      ...fair,
      setup: { ...fair.setup, recordEffectTrace: false }
    })
  type Match = ReturnType<typeof make>
  const legal = (match: Match) =>
    enumerateLegalCommands(
      {
        getState: match.getState,
        getPlayInput: match.getPlayInput!,
        getLegality: match.getLegality!
      },
      actorId
    )
  const rng = JSON.stringify(fair.rngState)
  const dispatch = (
    match: Match,
    command: TurnMatchCommand,
    allowDamageDraw = false
  ) => {
    if (stop()) {
      stats.abstained = true
      return false
    }
    stats.dispatches++
    const result = match.dispatch(command)
    return (
      result.accepted &&
      result.state.phase === 'turns' &&
      result.state.activePlayerId === actorId &&
      !result.state.pendingDiscover &&
      !result.state.pendingCardChoice &&
      !result.state.pendingResolution &&
      !result.state.scheduledEffects?.length &&
      !revealsTacticalInformation(
        result.events.filter(
          (event) =>
            !(
              allowDamageDraw &&
              event.type === 'card-drawn' &&
              event.participantId !== actorId &&
              !event.publicReveal
            )
        )
      ) &&
      !result.events.some(
        (event) =>
          event.type === 'trigger-activated' &&
          !(
            allowDamageDraw &&
            event.participantId !== actorId &&
            damageDrawSources.has(event.source.instanceId) &&
            event.trigger === 'on-damage'
          )
      ) &&
      JSON.stringify(match.getCheckpoint().rngState) === rng
    )
  }
  // Compare every public resource, allowing only damage, healing, attack use,
  // and (for a plain dagger) its single durability expenditure.
  const resourceKey = (match: Match, dagger = false) => {
    const observation = match.getAiObservation!(actorId, 'fair')
    return JSON.stringify({
      ...observation,
      revision: 0,
      players: observation.players.map((p) =>
        p.participantId === actorId
          ? {
              ...p,
              hero: {
                ...p.hero,
                health: 0,
                damageTaken: 0,
                ...(dagger
                  ? { attack: 0, attacksUsedThisTurn: 0, lastAttackedOnTurn: 0 }
                  : {})
              },
              ...(dagger ? { weapon: null } : {}),
              board: p.board.map((m) => ({
                ...m,
                attacksUsedThisTurn: 0,
                lastAttackedOnTurn: 0
              }))
            }
          : { ...p, hero: { ...p.hero, health: 0, armor: 0, damageTaken: 0 } }
      )
    })
  }
  const safeFace = (match: Match, command: TurnMatchCommand) => {
    if (command.type !== 'attack-character' || command.defender.kind !== 'hero')
      return false
    const before = match.getState()
    const self = before.players.find((p) => p.participantId === actorId)!
    const opponent = before.players.find((p) => p.participantId !== actorId)!
    // Keep weapon Deathrattles and retaliation out of this preference. Only
    // ordinary renewable Rogue daggers receive an attack-over-pass preference.
    if (
      command.attacker.kind === 'hero' &&
      (self.weapon?.cardId !== 'basic_wicked_knife' || opponent.board.length)
    )
      return false
    const key = resourceKey(match, command.attacker.kind === 'hero')
    const ownHealth = self.hero.health + self.hero.armor
    const otherHealth = opponent.hero.health + opponent.hero.armor
    const boardHealth = before.players.flatMap((p) => p.board.map((m) => m.health))
    if (!dispatch(match, command)) return false
    const after = match.getState()
    const nextSelf = after.players.find((p) => p.participantId === actorId)!
    const nextOther = after.players.find((p) => p.participantId !== actorId)!
    // Known health-threshold setup remains a search decision.
    const crossedThreshold = [12, 15].some(
      (threshold) =>
        opponent.hero.health > threshold && nextOther.hero.health <= threshold
    )
    return (
      !crossedThreshold &&
      nextSelf.hero.health + nextSelf.hero.armor >= ownHealth &&
      nextOther.hero.health + nextOther.hero.armor < otherHealth &&
      JSON.stringify(boardHealth) ===
        JSON.stringify(after.players.flatMap((p) => p.board.map((m) => m.health))) &&
      key === resourceKey(match, command.attacker.kind === 'hero')
    )
  }
  try {
    if (returnsMinions || refresh) {
      const baseline = make()
      if (!dispatch(baseline, selected)) return unchanged()
      const returned = new Set(
        own.board
          .filter(
            (minion) =>
              !baseline
                .getState()
                .players.find((p) => p.participantId === actorId)!
                .board.some((m) => m.instanceId === minion.instanceId)
          )
          .map((m) => m.instanceId)
      )
      const afterWeapon = baseline
        .getState()
        .players.find((p) => p.participantId === actorId)!.weapon
      const refreshesDagger =
        refresh &&
        own.weapon?.cardId === 'basic_wicked_knife' &&
        afterWeapon?.cardId === own.weapon.cardId &&
        afterWeapon.durability > own.weapon.durability
      const revised = make()
      const prefix: TurnMatchCommand[] = []
      for (const attack of legal(revised)) {
        if (attack.type !== 'attack-character') continue
        const bounceAttack =
          returnsMinions &&
          attack.attacker.kind === 'minion' &&
          returned.has(attack.attacker.instanceId)
        const daggerAttack = refreshesDagger && attack.attacker.kind === 'hero'
        if (!bounceAttack && !daggerAttack) continue
        if (daggerAttack) {
          // Compare the same attack target in both orders, including minion
          // trades. Opposing Acolyte draws are identical public draw counts;
          // concealed identities never contribute to the comparison. A draw
          // still invalidates the execution cache and requests a fresh decision.
          const candidate = make()
          if (attack.defender.kind === 'hero' && enemy.board.length) continue
          if (attack.defender.kind === 'minion') {
            const targetId = attack.defender.instanceId
            const target = enemy.board.find((m) => m.instanceId === targetId)
            const readyDamage = legal(revised).reduce(
              (sum, command) =>
                command.type === 'attack-character' &&
                command.attacker.kind === 'minion' &&
                command.defender.kind === 'minion' &&
                command.defender.instanceId === targetId
                  ? sum +
                    (own.board.find(
                      (m) =>
                        command.attacker.kind === 'minion' &&
                        m.instanceId === command.attacker.instanceId
                    )?.attack ?? 0)
                  : sum,
              0
            )
            if (
              !target ||
              target.attack > 1 ||
              target.health > own.weapon!.attack + readyDamage
            )
              continue
          }
          if (!dispatch(candidate, attack, true) || !dispatch(candidate, selected))
            continue
          const selectedOrder = createOpeningMatchFromCheckpoint(
            baseline.getCheckpoint()
          )
          if (!dispatch(selectedOrder, attack, true)) continue
          const beforeWeapon = selectedOrder
            .getState()
            .players.find((p) => p.participantId === actorId)!.weapon
          const nextWeapon = candidate
            .getState()
            .players.find((p) => p.participantId === actorId)!.weapon
          const normalized = (match: Match) => {
            const observation = match.getAiObservation!(actorId, 'fair')
            return JSON.stringify({
              ...observation,
              revision: 0,
              players: observation.players.map((p) =>
                p.participantId === actorId && p.weapon
                  ? {
                      ...p,
                      weapon: {
                        ...p.weapon,
                        // Damage resolution can consume an ordinal before the same
                        // unenchanted dagger is created in the other order.
                        instanceId: 'renewed-dagger',
                        durability: 0
                      }
                    }
                  : p
              )
            })
          }
          if (
            beforeWeapon &&
            nextWeapon &&
            nextWeapon.durability > beforeWeapon.durability &&
            normalized(candidate) === normalized(selectedOrder)
          ) {
            return {
              commands: [attack, selected],
              reason: 'attack-before-dagger-refresh',
              stats
            }
          }
          continue
        }
        const probe = createOpeningMatchFromCheckpoint(revised.getCheckpoint())
        if (!safeFace(probe, attack)) continue
        if (!dispatch(revised, attack)) return unchanged()
        prefix.push(attack)
      }
      if (!prefix.length || !dispatch(revised, selected)) return unchanged()
      // Returning to hand resets attack use. Thus the compared bounce outcomes
      // must match exactly except for hero damage/healing and diagnostic revision.
      if (resourceKey(baseline) !== resourceKey(revised)) return unchanged()
      return {
        commands: [...prefix, selected],
        reason: 'attack-before-friendly-return',
        stats
      }
    }
    if (selected.type === 'end-turn') {
      for (const attack of legal(make())) {
        const probe = make()
        if (safeFace(probe, attack))
          return { commands: [attack], reason: 'unused-safe-face-attack', stats }
      }
    }
    // Search only a single plain Taunt. No hidden replies, card plays or random
    // outcomes participate; incomplete branches never become a committed line.
    const taunts = enemy.board.filter((m) =>
      effectiveBoardMinionKeywords(m, state.turnNumber).includes('taunt')
    )
    if (
      taunts.length !== 1 ||
      enemy.board.length !== 1 ||
      own.board.length > 6 ||
      !['end-turn', 'attack-character'].includes(selected.type) ||
      state.players.some((p) =>
        p.board.some(
          (m) =>
            m.deathrattles?.length ||
            (!m.silenced &&
              CARD_CATALOG.require(m.cardId).effects.some(
                (e) => e.trigger === 'deathrattle'
              ))
        )
      )
    )
      return unchanged()
    const value = (match: Match) => {
      const players = match.getState().players
      const boardValue = (p: (typeof players)[number]) =>
        p.board.reduce(
          (sum, m) =>
            sum + 2 + 3 * CARD_CATALOG.require(m.cardId).cost + 2 * m.attack + m.health,
          0
        )
      const self = players.find((p) => p.participantId === actorId)!
      const opponent = players.find((p) => p.participantId !== actorId)!
      return (
        boardValue(self) -
        boardValue(opponent) +
        2 *
          (self.hero.health +
            self.hero.armor -
            opponent.hero.health -
            opponent.hero.armor)
      )
    }
    const root = make()
    let bestValue = value(root) + 0.5
    let best: TurnMatchCommand[] | null = null
    const visit = (match: Match, line: TurnMatchCommand[]) => {
      if (stop()) {
        stats.abstained = true
        return
      }
      const currentEnemy = match
        .getState()
        .players.find((p) => p.participantId !== actorId)!
      if (!currentEnemy.board.length && value(match) > bestValue) {
        bestValue = value(match)
        best = line
      }
      if (line.length >= 6) return
      const attacks = legal(match).filter(
        (c) => c.type === 'attack-character' && c.attacker.kind === 'minion'
      )
      for (const attack of attacks) {
        if (stop()) break
        const next = createOpeningMatchFromCheckpoint(match.getCheckpoint())
        if (currentEnemy.board.length ? dispatch(next, attack) : safeFace(next, attack))
          visit(next, [...line, attack])
      }
    }
    visit(root, [])
    return best
      ? { commands: best, reason: 'complete-plain-taunt-clear', stats }
      : unchanged()
  } finally {
    stats.durationMs = Math.max(0, now() - started)
  }
}
