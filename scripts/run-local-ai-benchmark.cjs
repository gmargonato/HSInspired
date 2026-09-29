#!/usr/bin/env node
'use strict'

const path = require('node:path')
const { spawnSync } = require('node:child_process')

const optionNames = new Map([
  ['--games', 'LOCAL_AI_BENCHMARK_GAMES'],
  ['--seed', 'LOCAL_AI_BENCHMARK_SEED'],
  ['--max-actions', 'LOCAL_AI_BENCHMARK_MAX_ACTIONS'],
  ['--turn-budget-ms', 'LOCAL_AI_BENCHMARK_TURN_BUDGET_MS'],
  ['--work-budget', 'LOCAL_AI_BENCHMARK_WORK_BUDGET'],
  ['--baseline', 'LOCAL_AI_BENCHMARK_BASELINE']
])

const environment = {
  ...process.env,
  RUN_LOCAL_AI_BENCHMARK: '1'
}

for (let index = 2; index < process.argv.length; index++) {
  const name = process.argv[index]
  if (name === '--curated') {
    environment.LOCAL_AI_BENCHMARK_CURATED = '1'
    continue
  }
  if (name === '--easy-mirror') {
    environment.LOCAL_AI_BENCHMARK_EASY_MIRROR = '1'
    continue
  }
  if (name === '--deck-id') {
    const deckId = process.argv[index + 1]
    if (!deckId || deckId.startsWith('--')) {
      process.stderr.write(
        'Usage: npm run benchmark:local-ai -- [--curated --games 4 | --curated --easy-mirror --games 1] [--deck-id ID] [--seed N] [--turn-budget-ms N]\n'
      )
      process.exit(2)
    }
    const existingDeckIds = environment.LOCAL_AI_BENCHMARK_DECK_IDS
    environment.LOCAL_AI_BENCHMARK_DECK_IDS = existingDeckIds
      ? existingDeckIds + ',' + deckId
      : deckId
    index++
    continue
  }
  if (name === '--trace-losses') {
    environment.LOCAL_AI_BENCHMARK_TRACE_LOSSES = '1'
    continue
  }
  const environmentName = optionNames.get(name)
  const value = process.argv[index + 1]
  if (!environmentName || value === undefined || value.startsWith('--')) {
    process.stderr.write(
      'Usage: npm run benchmark:local-ai -- [--curated --games 4 [--deck-id ID] | --curated --easy-mirror --games 1 [--deck-id ID]] [--games N] [--seed N] [--baseline easy|random] [--max-actions N] [--turn-budget-ms N] [--work-budget N] [--trace-losses]\n'
    )
    process.exit(2)
  }
  environment[environmentName] = value
  index++
}

const vitestEntry = path.resolve('node_modules/vitest/vitest.mjs')
const benchmarkTest = path.resolve(
  'src/renderer/features/game/local-ai-matchup-benchmark.test.ts'
)
const result = spawnSync(
  process.execPath,
  [vitestEntry, 'run', benchmarkTest, '--reporter=verbose'],
  { stdio: 'inherit', env: environment }
)

if (result.error) {
  process.stderr.write(String(result.error) + '\n')
  process.exit(1)
}
process.exit(result.status ?? 1)
