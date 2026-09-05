const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const root = join(__dirname, '..')
const cliArguments = process.argv.slice(2)
const pairCount = cliArguments.find((argument) => !argument.startsWith('--'))
if (pairCount !== undefined && !/^[1-9]\d*$/.test(pairCount)) {
  throw new Error('AI benchmark pair count must be a positive integer.')
}
const trace = cliArguments.includes('--trace')
const crossDeck = cliArguments.includes('--cross-deck')
const startArgument = cliArguments.find((argument) => argument.startsWith('--start='))
const startPair = startArgument?.slice('--start='.length)
if (startPair !== undefined && !/^\d+$/.test(startPair)) {
  throw new Error('AI benchmark start pair must be a non-negative integer.')
}
const result = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'src/game/match/ai/competitive-benchmark.test.ts'
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      HSINSPIRED_RUN_AI_BENCHMARK: '1',
      ...(pairCount ? { HSINSPIRED_AI_BENCHMARK_PAIRS: pairCount } : {}),
      ...(trace ? { HSINSPIRED_AI_BENCHMARK_TRACE: '1' } : {}),
      ...(crossDeck ? { HSINSPIRED_AI_BENCHMARK_CROSS_DECK: '1' } : {}),
      ...(startPair ? { HSINSPIRED_AI_BENCHMARK_START_PAIR: startPair } : {})
    },
    stdio: 'inherit'
  }
)

process.exitCode = result.status ?? 1
