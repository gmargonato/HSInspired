const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const root = join(__dirname, '..')
const result = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules', 'vitest', 'vitest.mjs'),
    'run',
    'src/game/match/ai/competitive-benchmark.test.ts'
  ],
  {
    cwd: root,
    env: { ...process.env, HSINSPIRED_RUN_AI_BENCHMARK: '1' },
    stdio: 'inherit'
  }
)

process.exitCode = result.status ?? 1
