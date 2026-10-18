import { CARD_CATALOG } from '../../../game-rules/content/cards'
import { enumerateLegalCommands } from '../../../game-rules/match/ai'
import {
  tacticalStateKey,
  terminalOutcome,
  revealsTacticalInformation
} from '../../../game-rules/match/ai/tactical-search'
import {
  boardMinionAttacksUsed,
  effectiveBoardMinionKeywords
} from '../../../game-rules/match/rules/minion-attack-state'
import type {
  OpeningMatchAnalysis,
  OpeningMatchState,
  PlayerId,
  TurnMatchCommand
} from '../../../game-rules/match'

type Attack = Extract<TurnMatchCommand, { type: 'attack-character' }>
export interface AttackReply {
  reply: 'lethal' | 'clear' | 'unknown'
  witness?: readonly Attack[]
}

/** Only these monotone protective secrets permit the immune/damage upper bounds. */
export function protectiveSecretsSupported(
  state: OpeningMatchState,
  actorId: PlayerId
): boolean {
  return state.players.every((player) =>
    (player.secrets ?? []).every((secret) => {
      if (player.participantId !== actorId) return false
      const effects = CARD_CATALOG.get(secret.cardId)?.effects
      return (
        !!effects?.length &&
        effects.every(
          (effect) =>
            effect.trigger === 'secret' &&
            effect.event?.type === 'hero-would-die' &&
            effect.event.controller === 'self' &&
            Object.keys(effect).every((key) =>
              ['trigger', 'event', 'actions'].includes(key)
            ) &&
            Object.keys(effect.event).every((key) =>
              ['type', 'controller'].includes(key)
            ) &&
            !!effect.actions?.length &&
            effect.actions.every((action) => {
              const target = action.target as Record<string, unknown> | undefined
              return (
                target?.controller === 'self' &&
                target.type === 'hero' &&
                target.selection === 'all' &&
                Object.keys(target).every((key) =>
                  ['controller', 'type', 'selection'].includes(key)
                ) &&
                ((action.action === 'prevent-lethal' &&
                  Object.keys(action).every((key) =>
                    ['action', 'target'].includes(key)
                  )) ||
                  (action.action === 'grant-keyword' &&
                    action.keyword === 'immune' &&
                    action.duration === 'this-turn' &&
                    Object.keys(action).every((key) =>
                      ['action', 'target', 'keyword', 'duration'].includes(key)
                    )))
              )
            })
        )
      )
    })
  )
}

/** Engine dispatch with actor knowledge, never an opponent-secret identity sample. */
export function applyPublicAttackStep(
  fork: OpeningMatchAnalysis,
  command: TurnMatchCommand
): boolean {
  const before = fork.getState()
  const rng = JSON.stringify(fork.getRandomState?.())
  const result = fork.dispatch(command)
  // Secret resolution is public to the defender who owns every supported secret.
  const events = result.events.filter(
    (event) => event.type !== 'secret-resolution-started'
  )
  return (
    result.accepted &&
    fork.getRandomState !== undefined &&
    rng === JSON.stringify(fork.getRandomState()) &&
    !revealsTacticalInformation(events, command.type === 'end-turn') &&
    !result.state.pendingDiscover &&
    !result.state.pendingCardChoice &&
    !result.state.pendingResolution &&
    before.phase === 'turns'
  )
}

/** Exhaustive legal attacks with conservative pruning. Exhaustion is unknown. */
export function inspectPublicAttackReply(
  root: OpeningMatchAnalysis,
  actorId: PlayerId,
  supported: (state: OpeningMatchState) => boolean,
  stop: () => boolean,
  witness?: readonly Attack[]
): AttackReply {
  // A known, unconditional prevent-lethal + same-turn immunity secret covers
  // every attack ordering inside this closed model. Also replay the concrete
  // lethal witness: a merely surviving sampled sequence is never this proof.
  const state = root.getState()
  const self = state.players.find((player) => player.participantId === actorId)!
  const shield = self.secrets?.some((secret) =>
    CARD_CATALOG.get(secret.cardId)?.effects.some(
      (effect) =>
        effect.actions?.some((action) => action.action === 'prevent-lethal') &&
        effect.actions.some(
          (action) => action.action === 'grant-keyword' && action.keyword === 'immune'
        )
    )
  )
  if (witness?.length && supported(state)) {
    const replay = root.analyze((fork) => {
      for (const attack of witness) {
        if (stop() || !applyPublicAttackStep(fork, attack) || stop()) return 'unknown'
        const position = fork.getState()
        if (terminalOutcome(position, actorId) === 'loss') return 'lethal'
        if (position.phase === 'ended') return 'unknown'
        if (
          shield &&
          protectiveSecretsSupported(state, actorId) &&
          position.players.find((player) => player.participantId === actorId)!.hero
            .immune
        )
          return 'clear'
      }
      return 'unknown'
    })
    if (replay === 'lethal') return { reply: 'lethal', witness }
    if (replay === 'clear' && !stop()) return { reply: 'clear' }
  }
  const clear = new Set<string>()
  const visit = (fork: OpeningMatchAnalysis, path: readonly Attack[]): AttackReply => {
    if (stop() || !supported(fork.getState())) return { reply: 'unknown' }
    const state = fork.getState()
    if (terminalOutcome(state, actorId) === 'loss')
      return { reply: 'lethal', witness: path }
    if (state.phase === 'ended') return { reply: 'clear' }
    if (state.activePlayerId === actorId) return { reply: 'unknown' }
    const self = state.players.find((player) => player.participantId === actorId)!
    const enemy = state.players.find((player) => player.participantId !== actorId)!
    // Supported attacks cannot remove hero immunity during this opposing turn.
    if (self.hero.immune) return { reply: 'clear' }
    // No attack-triggered growth exists inside the support boundary. Aura
    // movement can change attack, so use this upper bound only without auras.
    if (
      state.players.every((player) =>
        player.board.every(
          (minion) =>
            (minion.silenced ||
              !minion.enchantments?.some(
                (enchantment) => enchantment.duration === 'while-damaged'
              )) &&
            !CARD_CATALOG.get(minion.cardId)?.effects.some(
              (effect) => effect.trigger === 'aura'
            )
        )
      )
    ) {
      const upper = enemy.board.reduce(
        (sum, minion) =>
          sum +
          Math.max(0, minion.attack) *
            Math.max(
              0,
              (minion.maxAttacksPerTurn ??
                (effectiveBoardMinionKeywords(minion, state.turnNumber).includes(
                  'mega-windfury'
                )
                  ? 4
                  : effectiveBoardMinionKeywords(minion, state.turnNumber).includes(
                        'windfury'
                      )
                    ? 2
                    : 1)) +
                (minion.extraAttacksThisTurn ?? 0) -
                boardMinionAttacksUsed(minion, state.turnNumber)
            ),
        (Math.max(0, enemy.hero.attack) + Math.max(0, enemy.weapon?.attack ?? 0)) *
          Math.max(
            0,
            (enemy.hero.maxAttacksPerTurn ?? 1) -
              (enemy.hero.lastAttackedOnTurn === state.turnNumber
                ? (enemy.hero.attacksUsedThisTurn ?? 1)
                : 0)
          )
      )
      if (
        self.hero.health + self.hero.armor >
        upper * Math.max(1, self.hero.damageTakenMultiplier ?? 1)
      )
        return { reply: 'clear' }
    }
    const key = tacticalStateKey(fork, actorId)
    if (clear.has(key)) return { reply: 'clear' }
    const attacks = enumerateLegalCommands(fork, enemy.participantId).filter(
      (command): command is Attack => command.type === 'attack-character'
    )
    if (stop()) return { reply: 'unknown' }
    const attackValue = (command: Attack) =>
      command.attacker.kind === 'hero'
        ? enemy.hero.attack
        : (enemy.board.find(
            (minion) =>
              minion.instanceId ===
              (command.attacker as { instanceId: string }).instanceId
          )?.attack ?? 0)
    attacks.sort(
      (a, b) =>
        Number(b.defender.kind === 'hero') - Number(a.defender.kind === 'hero') ||
        (a.defender.kind === 'hero'
          ? attackValue(b) - attackValue(a)
          : attackValue(a) - attackValue(b))
    )
    let unknown = false
    for (const attack of attacks) {
      if (stop()) return { reply: 'unknown' }
      const result = fork.analyze((child) =>
        applyPublicAttackStep(child, attack)
          ? visit(child, [...path, attack])
          : { reply: 'unknown' as const }
      )
      if (result.reply === 'lethal') return result
      unknown ||= result.reply === 'unknown'
    }
    if (stop() || unknown) return { reply: 'unknown' }
    clear.add(key)
    return { reply: 'clear' }
  }
  return visit(root, [])
}
