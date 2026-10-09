// Executed only by run-expert-recorded-replays.cjs, which supplies isolated old
// policy modules and removes its temporary test/modules on exit.
/* eslint-disable @typescript-eslint/no-explicit-any -- Historical transcript projections have variable keys; their reconstructed states are asserted against the live engine below. */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { CARD_CATALOG, HERO_POWER_CATALOG } from '../src/game-rules/content'
import { createAiFixture } from '../src/game-rules/match/testing/ai-scenario-builder'
import { GameBoardSession } from '../src/scenes/match/game-board-session'
import { enumerateLegalCommands } from '../src/game-rules/match'
import { aiActions } from '../src/scenes/match/ai/ai-context'
import { ExpertAiDecisionApi } from '../src/scenes/match/ai/expert-ai-decision-api'
import { runExpertAiWorkerDecision } from '../src/scenes/match/ai/expert-ai.worker'
import { evaluateExpertAiWorld } from '../src/scenes/match/ai/expert-ai-world-runner'
import { ExpertAiDecisionApi as OldApi } from '../src/scenes/match/ai/replay-baseline-expert-ai-decision-api'
import { runExpertAiWorkerDecision as oldWorker } from '../src/scenes/match/ai/replay-baseline-expert-ai.worker'
import { evaluateExpertAiWorld as oldWorld } from '../src/scenes/match/ai/replay-baseline-expert-ai-world-runner'

const output = process.env.EXPERT_REPLAY_OUTPUT!
const cases = JSON.parse(readFileSync(join(output, 'contexts.json'), 'utf8'))
const workBudget = Number(process.env.EXPERT_REPLAY_WORK ?? 128)
const seeds = (process.env.EXPERT_REPLAY_SEEDS ?? '1005,1006,1007')
  .split(',')
  .map(Number)
const only = process.env.EXPERT_REPLAY_CASES?.split(',')
const resultsPath = join(output, 'results.jsonl')
const completed = new Set<string>()
if (process.env.EXPERT_REPLAY_RESUME === '1') {
  for (const line of readFileSync(resultsPath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)) {
    const row = JSON.parse(line)
    completed.add(`${row.id}:${row.seed}:${row.version}`)
  }
} else writeFileSync(resultsPath, '')

function card(name: string) {
  const matches = CARD_CATALOG.all.filter((c) => c.name === name)
  // Token names can repeat; selected contexts use these known authored tokens.
  const aliases = {
    Slime: 'naxxramas_slime',
    Sheep: 'basic_sheep',
    'Boom Bot': 'goblins_vs_gnomes_boom_bot'
  }
  const id = aliases[name]
  if (id) return CARD_CATALOG.require(id)
  if (matches.length !== 1)
    throw new Error(`Ambiguous/missing card ${name}: ${matches.map((c) => c.id)}`)
  return matches[0]
}
function ref(value: string) {
  return value.match(/\[([^\]]+)\]$/)?.[1] ?? value
}
function restore(value: any): any {
  if (Array.isArray(value)) return value.map(restore)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k.replace(/ ([a-zA-Z])/g, (_, c) => c.toUpperCase()),
        restore(v)
      ])
    )
  if (typeof value === 'string')
    return ref(value)
      .replaceAll('ai-player', 'fixture-player-two')
      .replaceAll('human-player', 'fixture-player-one')
  return value
}
function graveyard(value: string | undefined) {
  return [...(value ?? '').matchAll(/(?:^|, )(.+?) \((\d+)\)(?=, |$)/g)]
    .flatMap((m) =>
      Array.from({ length: Number(m[2]) }, () => ({ cardId: card(m[1]).id }))
    )
    .filter((c) => CARD_CATALOG.require(c.cardId).type === 'Minion')
}
function build(entry: any, seed: number) {
  const facts = restore(entry.state)
  const self = facts.players.find((p) => p.role === 'self'),
    enemy = facts.players.find((p) => p.role === 'opponent')
  // Keep card names intact in count maps (restore is for engine field names).
  const deck = Object.entries(entry.state['remaining Deck'] ?? {}).flatMap(
    ([name, count]) => Array(Number(count)).fill(card(name).id)
  )
  expect(deck.length, `${entry.id} remaining deck count`).toBe(self.deckSize)
  // The log gives a multiset, not deck order; use the same seeded order for both policies.
  let rng = seed >>> 0
  for (let i = deck.length - 1; i > 0; i--) {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0
    const j = rng % (i + 1)
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  const board = (p: any) =>
    (p.board ?? []).map((m) => ({
      cardId: card(m.name).id,
      attack: m.attack,
      health: m.health,
      maxHealth: m.maxHealth,
      ready: !m.combat?.restrictions?.includes(
        'summoning sickness or control changed this turn'
      ),
      divineShield: m.currentStatus?.shieldActive === true,
      frozen: m.combat?.restrictions?.includes('frozen')
    }))
  const weapon = (p: any) =>
    p.weapon
      ? {
          cardId: card(p.weapon.name).id,
          attack: p.weapon.attack,
          durability: p.weapon.durability,
          maxDurability: p.weapon.maxDurability
        }
      : undefined
  const power = (p: any) => {
    const result = HERO_POWER_CATALOG.all.find(
      (h) => h.displayName === p.heroPower.name
    )
    if (!result) throw new Error('Power ' + p.heroPower.name)
    return result.id
  }
  const fixture = createAiFixture({
    seed,
    turnNumber: facts.turn,
    aiHeroId: self.heroId,
    opponentHeroId: enemy.heroId,
    aiHealth: self.hero.health,
    aiArmor: self.hero.armor,
    opponentHealth: enemy.hero.health,
    opponentArmor: enemy.hero.armor,
    aiMana: self.mana.available,
    aiMaximumMana: self.mana.maximum,
    opponentMaximumMana: enemy.mana.maximum,
    aiHand: (self.hand ?? []).map((c) => ({
      cardId: card(c.name).id,
      currentCost: c.cost,
      baseCost: c.baseCost ?? card(c.name).cost
    })),
    opponentHand: Array(enemy.handSize).fill('basic_chillwind_yeti'),
    aiDeck: deck,
    opponentDeck: Array(enemy.deckSize).fill('basic_chillwind_yeti'),
    aiBoard: board(self),
    opponentBoard: board(enemy),
    aiWeapon: weapon(self),
    opponentWeapon: weapon(enemy),
    aiHeroPowerId: power(self),
    opponentHeroPowerId: power(enemy),
    aiHeroPowerAvailable: self.heroPower.available,
    opponentHeroPowerAvailable: enemy.heroPower.available,
    aiHeroPowerUsesThisTurn: self.heroPower.available ? 0 : 1,
    opponentHeroPowerUsesThisTurn: enemy.heroPower.available ? 0 : 1,
    aiFatigueDamage: self.fatigueDamage,
    opponentFatigueDamage: enemy.fatigueDamage,
    aiGraveyard: graveyard(
      entry.state.players.find((p) => p.role === 'self').graveyard
    ),
    opponentGraveyard: graveyard(
      entry.state.players.find((p) => p.role === 'opponent').graveyard
    )
  })
  const checkpoint: any = structuredClone(fixture.checkpoint)
  for (const [p, f] of [
    [checkpoint.state.players[1], self],
    [checkpoint.state.players[0], enemy]
  ]) {
    Object.assign(p.hero, f.hero)
    delete p.hero.combat
    delete p.hero.missingHealth
    Object.assign(p.mana, f.mana)
    Object.assign(p.heroPower, {
      cost: f.heroPower.cost,
      baseCost: f.heroPower.cost,
      available: f.heroPower.available
    })
    delete p.heroPowerCostOverride
    Object.assign(p, f.effects ?? {})
    for (let i = 0; i < p.hand.length && f.hand; i++) {
      p.hand[i].instanceId = f.hand[i].ref
      if (f.hand[i].activeEnchantments)
        p.hand[i].enchantments = f.hand[i].activeEnchantments
    }
    for (let i = 0; i < p.board.length; i++) {
      const m = p.board[i],
        source = f.board[i]
      m.instanceId = source.ref
      m.silenced = source.currentStatus?.isSilenced === true
      m.stealth = source.currentStatus?.stealthActive === true
      Object.assign(m, source.activeEffects ?? {})
      // The readable board omits copied deathrattles. Recover a recorded Raptor
      // battlecry from its original command and the then-visible target identity.
      const copyingPlay = entry.priorActions.find(
        (d) =>
          d.command?.type === 'play-card' &&
          restore(d.command.cardInstanceId) === m.instanceId &&
          card(source.name).effects.some((e) =>
            e.actions?.some((a) => a.action === 'grant-deathrattle')
          )
      )
      const copiedName = copyingPlay?.command.targets?.[0]?.instanceId
        ? entry.knownCards[copyingPlay.command.targets[0].instanceId]
        : undefined
      if (copiedName)
        m.deathrattles = [
          ...m.deathrattles,
          ...structuredClone(
            card(copiedName).effects.filter((e) => e.trigger === 'deathrattle')
          )
        ]
      if (
        !source.currentStatus?.shieldActive &&
        (m.enchantments ?? []).some((e) => e.keywords?.includes('divine-shield'))
      )
        m.divineShieldConsumed = true
      m.maxAttacksPerTurn = (source.activeKeywords ?? []).includes('windfury') ? 2 : 1
      m.attacksUsedThisTurn =
        m.maxAttacksPerTurn - (source.combat?.attacksRemaining ?? 1)
      m.lastAttackedOnTurn = m.attacksUsedThisTurn ? facts.turn : null
      // Preserve logged stats without counting permanent enchantments twice.
      m.baseAttack =
        m.attack - (m.enchantments ?? []).reduce((s, e) => s + (e.attackDelta ?? 0), 0)
      m.baseHealth =
        m.maxHealth -
        (m.enchantments ?? []).reduce((s, e) => s + (e.maximumHealthDelta ?? 0), 0)
    }
    if (p.weapon && f.weapon) {
      p.weapon.instanceId = f.weapon.ref
      p.weapon.enchantments = f.weapon.activeEnchantments ?? []
    }
  }
  checkpoint.state.revision = entry.revision
  const earlier = entry.priorActions
    .filter((d) => d.turn === facts.turn && d.command?.type === 'play-card')
    .map((d) => card(entry.knownCards[d.command.cardInstanceId]).id)
  checkpoint.state.history.cardsPlayedThisTurn = earlier
  const session = new GameBoardSession({
    setup: fixture.setup,
    decks: fixture.decks,
    checkpoint
  })
  // Validate reconstruction through the live public boundary, including attack exhaustion.
  const current = session.getState()
  const commands = legal(session)
  for (const [p, f] of [
    [current.players[1], self],
    [current.players[0], enemy]
  ]) {
    expect(p.hero.health).toBe(f.hero.health)
    expect(p.hero.armor).toBe(f.hero.armor)
    expect(p.heroPower.available).toBe(f.heroPower.available)
    expect(
      p.board.map((m) => [m.attack, m.health, m.maxHealth, m.divineShield])
    ).toEqual(
      (f.board ?? []).map((m) => [
        m.attack,
        m.health,
        m.maxHealth,
        m.currentStatus?.shieldActive === true
      ])
    )
    expect(p.hand.length).toBe(f.handSize)
    if (f.role === 'self') {
      expect(p.hand.map((c) => c.currentCost)).toEqual(
        (f.hand ?? []).map((c) => c.cost)
      )
      for (const m of f.board ?? [])
        expect(
          commands.some(
            (c) => c.type === 'attack-character' && c.attacker.instanceId === m.ref
          ),
          entry.id + ' ' + m.name + ' readiness'
        ).toBe(m.combat.canAttackNow)
    }
  }
  if (entry.nextContext) {
    const after = session.match.analyze((fork) => {
      const result = fork.dispatch(restore(entry.recordedActions[0].command))
      expect(result.accepted, entry.id + ' recorded command').toBe(true)
      return result.state
    })
    const expected = restore(entry.nextContext)
    for (const f of expected.players) {
      const p = after.players.find(
        (p) =>
          p.participantId ===
          (f.role === 'self' ? session.remoteParticipantId : session.localParticipantId)
      )!
      expect(
        [
          p.hero.health,
          p.hero.armor,
          p.mana.available,
          p.heroPower.available,
          p.heroPower.cost
        ],
        entry.id + ' recorded action result'
      ).toEqual([
        f.hero.health,
        f.hero.armor,
        f.mana.available,
        f.heroPower.available,
        f.heroPower.cost
      ])
      expect(
        p.board.map((m) => [
          CARD_CATALOG.require(m.cardId).name,
          m.attack,
          m.health,
          m.maxHealth,
          m.divineShield
        ]),
        entry.id + ' recorded board result'
      ).toEqual(
        (f.board ?? []).map((m) => [
          m.name,
          m.attack,
          m.health,
          m.maxHealth,
          m.currentStatus?.shieldActive === true
        ])
      )
      if (f.weapon)
        expect(
          [p.weapon?.attack, p.weapon?.durability],
          entry.id + ' recorded weapon result'
        ).toEqual([f.weapon.attack, f.weapon.durability])
    }
  }
  return session
}
function legal(session: any) {
  return enumerateLegalCommands(
    {
      getState: session.match.getState,
      getPlayInput: session.match.getPlayInput!,
      getLegality: session.match.getLegality!
    },
    session.remoteParticipantId
  )
}
function snapshot(session: any) {
  return session.getState().players.map((p) => ({
    id: p.participantId,
    hero: p.hero,
    mana: p.mana,
    hand: p.hand.map((c) => CARD_CATALOG.require(c.cardId).name),
    board: p.board.map((m) => ({
      name: CARD_CATALOG.require(m.cardId).name,
      attack: m.attack,
      health: m.health,
      shield: m.divineShield
    })),
    weapon: p.weapon
  }))
}

describe('recorded Expert position comparison', () => {
  for (const entry of cases.filter((e) => !only || only.includes(e.id)))
    for (const seed of seeds)
      for (const version of (process.env.EXPERT_REPLAY_VERSIONS ?? 'old,current').split(
        ','
      )) {
        if (completed.has(`${entry.id}:${seed}:${version}`)) continue
        it(`${entry.id} / ${seed} / ${version}`, async () => {
          const session = build(entry, seed)
          if (process.env.EXPERT_REPLAY_VALIDATE_ONLY === '1') return
          const Api = version === 'old' ? OldApi : ExpertAiDecisionApi
          const run = version === 'old' ? oldWorker : runExpertAiWorkerDecision
          const world = version === 'old' ? oldWorld : evaluateExpertAiWorld
          let listener: any,
            step = 0
          const worker = {
            addEventListener(type: string, fn: any) {
              if (type === 'message') listener = fn
            },
            terminate() {},
            postMessage(message: any) {
              if (message.type !== 'decide') return
              const controlled = { ...message, seed: seed + step * 997 }
              void run(controlled, {
                evaluateWorld: (request, index, budget) =>
                  world(request, index, budget, { workBudget })
              })
                .then((response) => {
                  if (!response) throw new Error('No search response')
                  listener({
                    data: {
                      type: 'decision',
                      requestId: message.request.requestId,
                      response
                    }
                  })
                })
                .catch((error) =>
                  listener({
                    data: {
                      type: 'failure',
                      requestId: message.request.requestId,
                      error: String(error)
                    }
                  })
                )
            }
          }
          // Fixed logical clock prevents serial headless worlds consuming production
          // wall budgets. Search iterations, world count and seeds remain matched.
          const api = new Api(
            session,
            () => worker as unknown as Worker,
            () => 0,
            session.remoteParticipantId,
            100
          )
          const actions: any[] = []
          const initial = snapshot(session)
          const request = (phase: any) => ({
            matchId: 'recorded-replay',
            requestId: `${entry.id}:${seed}:${step}:${phase}`,
            phase,
            expectedRevision: session.getState().revision,
            allowInspection: false,
            messages: [],
            actionIds: aiActions(session, legal(session)).map((a) => a.id)
          })
          const started = performance.now()
          try {
            await api.decide(request('plan'))
            for (; step < 24; step++) {
              if (
                session.getState().phase === 'ended' ||
                session.getState().activePlayerId !== session.remoteParticipantId
              )
                break
              const choices = aiActions(session, legal(session))
              const response = await api.decide(request('action'))
              const selected = choices.find(
                (a) =>
                  'actionId' in response.choice && a.id === response.choice.actionId
              )
              expect(selected, 'legal selection').toBeDefined()
              const before = snapshot(session)
              const result = session.match.dispatch(selected!.command)
              expect(result.accepted, 'accepted command').toBe(true)
              actions.push({
                description: selected!.description,
                command: selected!.command,
                finishReason: response.finishReason,
                usage: response.usage,
                before,
                events: result.events,
                after: snapshot(session)
              })
            }
            expect(step, 'turn completed').toBeLessThan(24)
            const result = {
              id: entry.id,
              seed,
              version,
              workBudget,
              baseline: process.env.EXPERT_REPLAY_BASELINE,
              initial,
              actions,
              final: snapshot(session),
              phase: session.getState().phase,
              winner: session.getState().winnerId,
              durationMs: performance.now() - started
            }
            appendFileSync(resultsPath, JSON.stringify(result) + '\n')
            console.log(
              'REPLAY_COMPLETE',
              entry.id,
              seed,
              version,
              actions.map((a) => a.description).join(' -> ')
            )
          } finally {
            api.dispose()
          }
        }, 180_000)
      }
})
