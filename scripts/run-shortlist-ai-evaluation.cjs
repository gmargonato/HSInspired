#!/usr/bin/env node
'use strict'

// Reuses the production-policy headless benchmark, never a scripted card policy.
const { spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const path = require('node:path')
const definitions = readFileSync(
  'src/game-rules/decks/shortlisted-opponent-decks.ts',
  'utf8'
)
const ids = [...definitions.matchAll(/id: '(shortlist-[^']+)'/g)].map(
  (match) => match[1]
)
const options = new Map()
for (let i = 2; i < process.argv.length; i += 2) {
  if (
    !process.argv[i + 1] ||
    ![
      '--deck-id',
      '--opponent-deck-id',
      '--output',
      '--work-budget',
      '--games',
      '--seed',
      '--matrix'
    ].includes(process.argv[i])
  )
    throw new Error(
      'Expected --deck-id, --opponent-deck-id, --output, --work-budget, --games or --seed followed by a value.'
    )
  options.set(process.argv[i], process.argv[i + 1])
}
const candidates = options.has('--deck-id') ? [options.get('--deck-id')] : ids
if (!candidates.length || candidates.some((id) => !ids.includes(id)))
  throw new Error('Unknown shortlist deck.')
const opponents = options.has('--opponent-deck-id')
  ? [options.get('--opponent-deck-id')]
  : ['hunter-face-burn', 'mage-mech-tempo', 'warrior-justicar-control']
if (options.has('--matrix') && !['full', 'rotated'].includes(options.get('--matrix')))
  throw new Error('--matrix must be full or rotated.')
const output = options.get('--output') ?? '/tmp/shortlist-ai-evaluation.json'
const report = {
  description:
    'Small capability sample, not a competitive strength estimate. Both sides use the current shared production AI policy with Easy resource profile; explicit fixed-work cap is recorded per run. Equal-seed paired games swap deck seats and first-player advantage. No AI hero-power bonus.',
  runs: [],
  failures: [],
  summary: []
}
mkdirSync(path.dirname(output), { recursive: true })
for (const candidate of candidates)
  for (const opponent of options.get('--matrix') === 'rotated'
    ? [opponents[ids.indexOf(candidate) % opponents.length]]
    : opponents) {
    process.stdout.write(`Evaluating ${candidate} vs ${opponent}\n`)
    const result = spawnSync(
      process.execPath,
      [
        'scripts/run-local-ai-benchmark.cjs',
        '--curated',
        '--easy-mirror',
        '--games',
        options.get('--games') ?? '2',
        '--deck-id',
        candidate,
        '--opponent-deck-id',
        opponent,
        '--max-actions',
        '1000',
        '--work-budget',
        options.get('--work-budget') ?? '8',
        '--seed',
        options.get('--seed') ?? '20261107'
      ],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 }
    )
    const match = (result.stdout ?? '').match(/LOCAL_AI_BENCHMARK_JSON (\{[^\n]+\})/)
    if (match) {
      const run = JSON.parse(match[1])
      report.runs.push(run)
      process.stdout.write(
        `${run.matches.filter((game) => game.status === 'completed').length}/${run.matches.length} finished; ${run.matches.reduce((n, game) => n + game.rejectedCommands, 0)} rejected commands\n`
      )
    }
    if (result.status !== 0 || !match)
      report.failures.push({
        candidate,
        opponent,
        exitCode: result.status,
        error: result.error?.message,
        outputTail: ((result.stdout ?? '') + (result.stderr ?? '')).slice(-12000)
      })
    report.summary = candidates.map((deckId) => {
      const games = report.runs
        .flatMap((run) => run.matches)
        .filter((game) => game.candidateDeckId === deckId)
      return {
        deckId,
        games: games.length,
        completed: games.filter((game) => game.status === 'completed').length,
        wins: games.filter(
          (game) =>
            game.status === 'completed' &&
            game.winnerParticipantId === game.candidateParticipantId
        ).length,
        losses: games.filter(
          (game) =>
            game.status === 'completed' &&
            game.winnerParticipantId !== game.candidateParticipantId
        ).length,
        draws: games.filter((game) => game.status === 'draw').length,
        capped: games.filter((game) => game.status === 'capped').length,
        illegalSelections: games.reduce((n, game) => n + game.invalidSelections, 0),
        rejectedCommands: games.reduce((n, game) => n + game.rejectedCommands, 0),
        playedCardIds: [
          ...new Set(
            games.flatMap((game) =>
              game.decisionCoverage
                .filter(
                  (coverage) => coverage.participantId === game.candidateParticipantId
                )
                .flatMap((coverage) => coverage.playedCardIds)
            )
          )
        ].sort()
      }
    })
    writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
  }
process.stdout.write(`Report: ${output}\n`)
if (report.failures.length) process.exitCode = 1
