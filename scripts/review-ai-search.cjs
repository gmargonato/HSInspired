#!/usr/bin/env node
'use strict'

// Headless policy comparison. Bundles stay in memory; no application is launched.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const esbuild = require('esbuild')
const args = process.argv.slice(2)
const option = (name, fallback) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback
// Capture before changing the policy, then run positions followed by matchups.
const baselinePath = option(
  '--baseline',
  'artifacts/ai-search-review/baseline-source.json'
)
if (args.includes('--capture-baseline')) {
  const sources = {}
  for (const file of fs.readdirSync('src/scenes/match/ai').sort()) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const name = 'src/scenes/match/ai/' + file
    sources[name] = fs.readFileSync(name, 'utf8')
  }
  const tactical = 'src/game-rules/match/ai/tactical-search.ts'
  sources[tactical] = fs.readFileSync(tactical, 'utf8')
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(baselinePath, JSON.stringify(sources))
  console.log('Captured AI baseline: ' + baselinePath)
  process.exit(0)
}
const stage = option('--stage', 'positions')
const budget = Number(option('--work-budget', stage === 'positions' ? 128 : 32))
const seeds = Number(option('--seeds', stage === 'positions' ? 4 : 2))
const maxActions = Number(option('--max-actions', 500))
const firstSeed = Number(option('--seed', 20261109))
const traceActions = args.includes('--trace')
if (
  !['positions', 'matchups'].includes(stage) ||
  ![budget, seeds, maxActions].every((n) => Number.isSafeInteger(n) && n > 0)
)
  throw new Error('Invalid stage or compute limit.')
const baselineSource = fs.readFileSync(baselinePath, 'utf8')
const snapshot = JSON.parse(baselineSource)
const output = option('--output', `artifacts/ai-search-review/${stage}.json`)
const entry = `
export { CARD_CATALOG } from './src/game-rules/content/cards';
export { CURATED_OPPONENT_DECKS } from './src/game-rules/decks/curated-opponent-decks';
export { createAiFixture } from './src/game-rules/match/testing/ai-scenario-builder';
export { GameBoardSession } from './src/scenes/match/game-board-session';
export { LocalAiDecisionApi } from './src/scenes/match/ai/local-ai-decision-api';
export { aiActions } from './src/scenes/match/ai/ai-context';
export { enumerateLegalCommands } from './src/game-rules/match/ai/legal-commands';
export { inspectExpertAction } from './src/scenes/match/ai/expert-action-outcome';
export { EXPERT_AI_POLICY_REVISION } from './src/scenes/match/ai/expert-ai-worker-protocol';
`

async function library(baseline) {
  const plugins = baseline
    ? [
        {
          name: 'saved-ai-baseline',
          setup(build) {
            build.onLoad({ filter: /\.ts$/ }, ({ path: file }) => {
              const relative = path.relative(process.cwd(), file).replaceAll('\\', '/')
              return Object.hasOwn(snapshot, relative)
                ? { contents: snapshot[relative], loader: 'ts' }
                : undefined
            })
          }
        }
      ]
    : []
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    plugins,
    logLevel: 'silent'
  })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(
    module,
    module.exports,
    require
  )
  return module.exports
}

function actorView(lib, live, actor) {
  const checkpoint = live.match.getCheckpoint()
  const setup = {
    ...checkpoint.setup,
    recordEffectTrace: false,
    participants: checkpoint.setup.participants.map((p) => ({
      ...p,
      controllerKind: p.participantId === actor ? 'ai' : 'human'
    }))
  }
  return new lib.GameBoardSession({
    setup,
    decks: checkpoint.decks,
    checkpoint: { ...checkpoint, setup }
  })
}

async function decide(lib, session, requestId) {
  const actions = lib.aiActions(
    session,
    session.match.analyze((root) =>
      lib.enumerateLegalCommands(root, session.remoteParticipantId)
    )
  )
  if (!actions.length) throw new Error('No legal action at a live decision.')
  if (actions.length === 1) return { action: actions[0], trace: null }
  const api = new lib.LocalAiDecisionApi(session, undefined, {
    profile: 'expert',
    workBudget: budget
  })
  const response = await api.decide({
    matchId: 'search-review',
    requestId,
    expectedRevision: session.getState().revision,
    phase: 'action',
    allowInspection: false,
    messages: [],
    actionIds: actions.map((a) => a.id)
  })
  const action = actions.find((a) => a.id === response.choice.actionId)
  if (!action) throw new Error('Policy selected an action outside its legal list.')
  return { action, trace: api.getLastTrace() }
}

const emptyMetrics = () => ({
  burns: 0,
  draws: 0,
  fatigue: 0,
  noPayoffCasts: 0,
  passesWithMana: 0,
  decisions: 0
})
function collect(metrics, before, result, command, actor, judge) {
  metrics.decisions++
  for (const event of result.events)
    if (event.participantId === actor) {
      if (event.type === 'card-burned') metrics.burns++
      if (event.type === 'card-drawn') metrics.draws++
    }
  const old = before.state.players.find((p) => p.participantId === actor)
  const next = result.state.players.find((p) => p.participantId === actor)
  metrics.fatigue += Math.max(0, next.fatigueDamage - old.fatigueDamage)
  if (command.type === 'end-turn' && old.mana.available > 0) metrics.passesWithMana++
  if (command.type === 'play-card' && judge?.reason === 'no-payoff')
    metrics.noPayoffCasts++
}

function position(lib, turn, seed) {
  const id = (name) => {
    const card = lib.CARD_CATALOG.all.find((c) => c.name === name)
    if (!card) throw new Error('Unknown position card: ' + name)
    return card.id
  }
  const names = (list) => list.map(id)
  const common = {
    seed,
    turnNumber: turn,
    aiHeroId: 'thrall',
    opponentHeroId: 'guldan',
    opponentReplacementHeroId: 'jaraxxus',
    aiHeroPowerCost: 2,
    opponentHeroPowerAvailable: false,
    aiGraveyard: [{ cardId: id('Bloodmage Thalnos') }]
  }
  const hand = [
    'Lightning Storm',
    'Volcano',
    'Devolve',
    'Sludge Belcher',
    'Lightning Storm',
    "N'Zoth, the Corruptor",
    'Sludge Belcher',
    'Volcano'
  ]
  const options =
    turn === 15
      ? {
          aiMana: 7,
          aiMaximumMana: 8,
          aiOverloadLocked: 1,
          aiHealth: 30,
          opponentHealth: 24,
          opponentArmor: 5,
          opponentMaximumMana: 7,
          aiHand: names([...hand, 'Ancestral Knowledge']),
          aiDeck: names([
            'Harrison Jones',
            'Tidal Surge',
            'Doomsayer',
            'Sylvanas Windrunner',
            'Devolve',
            'Hallazeal the Ascended',
            'Maelstrom Portal',
            'White Eyes',
            'Healing Wave',
            'Doomsayer',
            'Jinyu Waterspeaker',
            'Far Sight',
            'Cairne Bloodhoof'
          ]),
          aiBoard: [
            'Jinyu Waterspeaker',
            'Mana Tide Totem',
            'Searing Totem',
            'Gadgetzan Jouster'
          ].map((name) => ({ cardId: id(name), ready: true })),
          opponentWeapon: { cardId: id('Blood Fury'), attack: 3, durability: 7 },
          opponentHand: Array(9).fill(id('Wisp')),
          opponentDeck: Array(17).fill(id('Wisp'))
        }
      : turn === 17
        ? {
            aiMana: 7,
            aiMaximumMana: 9,
            aiOverloadLocked: 2,
            aiHealth: 27,
            opponentHealth: 21,
            opponentMaximumMana: 8,
            aiHand: names([...hand, 'Tidal Surge', 'Doomsayer']),
            aiDeck: names(['Far Sight', 'Cairne Bloodhoof']),
            aiBoard: [
              {
                cardId: id('Jinyu Waterspeaker'),
                attack: 3,
                health: 3,
                maxHealth: 6,
                ready: true
              },
              {
                cardId: id('Harrison Jones'),
                attack: 5,
                health: 1,
                maxHealth: 4,
                ready: true
              }
            ],
            opponentBoard: [
              { cardId: id('Infernal') },
              { cardId: id('Faceless Shambler'), attack: 6, health: 6, maxHealth: 6 }
            ],
            opponentHand: Array(8).fill(id('Wisp')),
            opponentDeck: Array(16).fill(id('Wisp'))
          }
        : {
            aiMana: 10,
            aiMaximumMana: 10,
            aiHealth: 4,
            opponentHealth: 13,
            opponentMaximumMana: 9,
            aiHand: names(
              hand.filter((name) => name !== 'Devolve').concat('Far Sight')
            ),
            aiDeck: names(['Cairne Bloodhoof']),
            aiGraveyard: [
              'Bloodmage Thalnos',
              'Mana Tide Totem',
              'Jinyu Waterspeaker',
              'Harrison Jones',
              'Doomsayer'
            ].map((name) => ({ cardId: id(name) })),
            opponentHand: Array(6).fill(id('Wisp')),
            opponentDeck: Array(15).fill(id('Wisp'))
          }
  return new lib.GameBoardSession(lib.createAiFixture({ ...common, ...options }))
}

function summary(state, actor) {
  const own = state.players.find((p) => p.participantId === actor)
  const enemy = state.players.find((p) => p.participantId !== actor)
  const board = (p) =>
    p.board.map((m) => ({ cardId: m.cardId, attack: m.attack, health: m.health }))
  return {
    health: own.hero.health,
    armor: own.hero.armor,
    hand: own.hand.length,
    deck: own.deck.length,
    overload: own.mana.overloadNextTurn ?? 0,
    board: board(own),
    enemyBoard: board(enemy),
    enemyHealth: enemy.hero.health
  }
}

async function positions(libs, report) {
  for (const turn of [15, 17, 19])
    for (let index = 0; index < seeds; index++)
      for (const variant of args.includes('--variant')
        ? [option('--variant')]
        : ['baseline', 'candidate']) {
        const seed = firstSeed + index
        const lib = libs[variant],
          live = position(lib, turn, seed),
          actor = live.remoteParticipantId
        const row = { turn, seed, variant, metrics: emptyMetrics(), actions: [] }
        for (
          let step = 0;
          step < 12 &&
          live.getState().activePlayerId === actor &&
          live.getState().phase === 'turns';
          step++
        ) {
          const before = live.match.getCheckpoint()
          const { action, trace } = await decide(
            lib,
            live,
            `position-${turn}-${seed}-${step}`
          )
          const judge = live.match.analyze((root) =>
            libs.candidate.inspectExpertAction(root, actor, action.command)
          )
          const result = live.dispatch(action.command)
          if (!result.accepted) throw new Error(result.message)
          collect(row.metrics, before, result, action.command, actor, judge)
          row.actions.push({
            description: action.description,
            selected: trace?.candidates.find((c) => c.actionId === action.id) ?? null
          })
        }
        row.after = summary(live.getState(), actor)
        row.completedTurn = live.getState().activePlayerId !== actor
        report.results.push(row)
        save(report)
        console.log(
          JSON.stringify({
            turn,
            seed,
            variant,
            metrics: row.metrics,
            after: row.after
          })
        )
      }
}

async function matchups(libs, report) {
  const ids = option(
    '--deck-ids',
    'shortlist-secret-burn-mage,shortlist-skipper-enrage-warrior,shortlist-elemental-curve-shaman'
  ).split(',')
  for (const deckId of ids)
    for (let index = 0; index < seeds; index++)
      for (const candidateSeat of args.includes('--seat')
        ? [Number(option('--seat'))]
        : [0, 1]) {
        const entry = libs.candidate.CURATED_OPPONENT_DECKS.find(
          (d) => d.definition.id === deckId
        )
        if (!entry) throw new Error('Unknown comparison deck: ' + deckId)
        const seed = firstSeed + index
        const decks = [0, 1].map((seat) => ({
          ...entry.deck,
          id: `review-deck-${seat}`
        }))
        const setup = {
          seed,
          recordEffectTrace: false,
          aiHeroPowerBonusEnabled: false,
          startingParticipantId: 'review-player-0',
          participants: decks.map((deck, seat) => ({
            participantId: `review-player-${seat}`,
            controllerKind: seat === 0 ? 'human' : 'ai',
            heroId: deck.heroId,
            deckId: deck.id
          }))
        }
        const live = new libs.candidate.GameBoardSession({ setup, decks })
        for (const participant of setup.participants) {
          const result = live.dispatch({
            type: 'confirm-mulligan',
            participantId: participant.participantId,
            replaceInstanceIds: []
          })
          if (!result.accepted) throw new Error(result.message)
        }
        const row = {
          deckId,
          seed,
          candidateSeat,
          metrics: { baseline: emptyMetrics(), candidate: emptyMetrics() },
          actions: 0
        }
        if (traceActions) row.trace = []
        while (live.getState().phase === 'turns' && row.actions < maxActions) {
          const state = live.getState(),
            actor =
              state.pendingDiscover?.participantId ??
              state.pendingCardChoice?.participantId ??
              state.activePlayerId
          const variant =
            actor === `review-player-${candidateSeat}` ? 'candidate' : 'baseline'
          const view = actorView(libs[variant], live, actor)
          const { action, trace } = await decide(
            libs[variant],
            view,
            `match-${deckId}-${seed}-${state.revision}`
          )
          const before = live.match.getCheckpoint()
          if (traceActions) {
            const own = state.players.find((p) => p.participantId === actor)
            row.trace.push({
              turn: state.turnNumber,
              variant,
              action: action.description,
              mana: own.mana.available,
              hand: own.hand.map((c) => ({ cardId: c.cardId, cost: c.currentCost })),
              board: summary(state, actor),
              candidates:
                trace?.candidates.map((c) => ({
                  action: c.description,
                  visits: c.visits,
                  mean: c.meanValue,
                  recommendation: c.recommendationValue
                })) ?? []
            })
          }
          const judge = live.match.analyze((root) =>
            libs.candidate.inspectExpertAction(root, actor, action.command)
          )
          const result = live.dispatch(action.command)
          if (!result.accepted) throw new Error(result.message)
          collect(row.metrics[variant], before, result, action.command, actor, judge)
          row.actions++
        }
        row.status = live.getState().phase === 'ended' ? 'completed' : 'capped'
        row.winner = live.getState().winnerId
          ? live.getState().winnerId === `review-player-${candidateSeat}`
            ? 'candidate'
            : 'baseline'
          : null
        row.turn = live.getState().turnNumber
        report.results.push(row)
        save(report)
        console.log(
          JSON.stringify({
            ...row,
            ...(traceActions ? { trace: 'saved in report' } : {})
          })
        )
      }
}

function save(report) {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
}

;(async () => {
  const libs = { baseline: await library(true), candidate: await library(false) }
  const report = {
    stage,
    engine: 'headless-local-search',
    baselinePolicy: libs.baseline.EXPERT_AI_POLICY_REVISION,
    candidatePolicy: libs.candidate.EXPERT_AI_POLICY_REVISION,
    baselineHash: crypto.createHash('sha256').update(baselineSource).digest('hex'),
    workBudget: budget,
    seeds,
    firstSeed,
    maxActions,
    mulligan: 'keep-all',
    note: 'Public-position reconstructions use concealed placeholder hands; policies sample fair hypotheses. Matchups use identical decks, paired seeds/seats, no AI bonuses, and a fixed old-policy opponent. Small fixed-work samples are regression evidence, not competitive win rates.',
    results: []
  }
  save(report)
  await (stage === 'positions' ? positions(libs, report) : matchups(libs, report))
  console.log('Review saved to ' + output)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
