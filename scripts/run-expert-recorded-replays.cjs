const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { readMatch } = require('./extract-expert-replay-contexts.cjs')
const { createHash } = require('node:crypto')

const output = path.resolve(
  process.env.EXPERT_REPLAY_OUTPUT ?? 'artifacts/expert-recorded-replays'
)
fs.mkdirSync(output, { recursive: true })
const cases = [
  ['pain-doomsayer', '8325b87b', 20],
  ['toads-doomsayer', '2efc341b', 10],
  ['voidcaller-shadowflame', '3cce5bfd', 38],
  ['thalnos-frostbolt', '45619599', 12],
  ['abusive-target', 'f6ce533a', 34],
  ['shredder-development', '37005e7d', 11],
  ['brann-priority', '13ad2418', 57],
  ['zero-armor-slam', '13ad2418', 83],
  ['zero-mana-healing', 'f6ce533a', 10],
  ['zero-mana-shaping', '8325b87b', 10],
  ['full-health-heal', '8325b87b', 6]
].map(([id, prefix, requestNumber]) => {
  const { directory, log, contexts } = readMatch(prefix)
  const context = contexts.find((c) => c.requestId.endsWith(':' + requestNumber))
  if (!context) throw new Error('Missing context ' + id)
  const priorActions = log.decisions.filter(
    (d) => d.kind === 'action-executed' && d.revision <= context.revision
  )
  return {
    id,
    directory,
    matchId: log.matchId,
    policy: 'expert-tactics-1',
    ...context,
    priorActions,
    nextContext: contexts.find(
      (c) =>
        c.revision ===
        log.decisions.find(
          (d) =>
            d.kind === 'action-executed' &&
            d.turn === context.state.turn &&
            d.revision > context.revision
        )?.revision
    )?.state,
    knownCards: Object.fromEntries(
      contexts
        .filter((c) => c.revision <= context.revision)
        .flatMap((c) =>
          c.state.players.flatMap((p) => [...(p.hand ?? []), ...(p.board ?? [])])
        )
        .map((c) => [c.ref.match(/\[([^\]]+)\]$/)?.[1] ?? c.ref, c.name])
    ),
    recordedActions: log.decisions.filter(
      (d) =>
        d.kind === 'action-executed' &&
        d.turn === context.state.turn &&
        d.revision > context.revision
    ),
    strategy: log.expertDeckStrategy
  }
})
fs.writeFileSync(path.join(output, 'contexts.json'), JSON.stringify(cases, null, 2))
const baseline = execFileSync(
  'git',
  [
    'rev-parse',
    process.env.EXPERT_REPLAY_BASELINE ?? '19a04e6ddc2f2b8838ca535e3f2c22efac3f9eae'
  ],
  { encoding: 'utf8' }
).trim()
const modules = [
  'local-ai-decision-api',
  'expert-ai-action-safety',
  'expert-ai-decision-api',
  'expert-ai-timeout-fallback',
  'expert-ai-worker-protocol',
  'expert-ai.worker',
  'expert-ai-world-runner'
]
const created = []
function temporary(file, content) {
  fs.writeFileSync(file, content, { flag: 'wx' })
  created.push(file)
}
let result
try {
  for (const name of modules) {
    const source = 'src/scenes/match/ai/' + name + '.ts'
    let code = execFileSync('git', ['show', baseline + ':' + source], {
      encoding: 'utf8',
      maxBuffer: 4e6
    })
    for (const dependency of modules)
      code = code.replaceAll(
        "'./" + dependency + "'",
        "'./replay-baseline-" + dependency + "'"
      )
    temporary(path.resolve('src/scenes/match/ai/replay-baseline-' + name + '.ts'), code)
  }
  const previous =
    process.env.EXPERT_REPLAY_RESUME === '1'
      ? [
          ...new Map(
            ['results.jsonl', 'worker-0/results.jsonl', 'worker-1/results.jsonl']
              .filter((file) => fs.existsSync(path.join(output, file)))
              .flatMap((file) =>
                fs
                  .readFileSync(path.join(output, file), 'utf8')
                  .trim()
                  .split('\n')
                  .filter(Boolean)
                  .map(JSON.parse)
              )
              .map((row) => [`${row.id}:${row.seed}:${row.version}`, row])
          ).values()
        ]
      : []
  if (
    previous.some(
      (row) => row.workBudget !== Number(process.env.EXPERT_REPLAY_WORK ?? 128)
    )
  )
    throw new Error('Use a different output directory when changing the work budget.')
  const selected = cases.filter(
    (c) =>
      !process.env.EXPERT_REPLAY_CASES ||
      process.env.EXPERT_REPLAY_CASES.split(',').includes(c.id)
  )
  if (!selected.length) throw new Error('No matching replay cases.')
  const groups = [0, 1]
    .map((index) => selected.filter((_, i) => i % 2 === index).map((c) => c.id))
    .filter((ids) => ids.length)
  const jobs = groups.map((ids, index) => {
    const directory = path.join(output, 'worker-' + index)
    fs.mkdirSync(directory, { recursive: true })
    fs.copyFileSync(
      path.join(output, 'contexts.json'),
      path.join(directory, 'contexts.json')
    )
    fs.writeFileSync(
      path.join(directory, 'results.jsonl'),
      previous
        .filter((r) => ids.includes(r.id))
        .map(JSON.stringify)
        .join('\n') + '\n'
    )
    const test = path.resolve('scripts/expert-recorded-replay-' + index + '.test.ts')
    temporary(
      test,
      `process.env.EXPERT_REPLAY_OUTPUT = ${JSON.stringify(directory)}\nprocess.env.EXPERT_REPLAY_CASES = ${JSON.stringify(ids.join(','))}\n` +
        fs.readFileSync('scripts/expert-recorded-replay-harness.ts', 'utf8')
    )
    return { directory, test }
  })
  const sourceFiles = [
    ...modules.map((name) => 'src/scenes/match/ai/' + name + '.ts'),
    'src/scenes/match/ai/expert-action-outcome.ts',
    ...jobs.map((j) => j.test)
  ]
  fs.writeFileSync(
    path.join(output, 'manifest.json'),
    JSON.stringify(
      {
        baseline,
        workers: jobs.map((j) => path.relative(output, j.directory)),
        workBudget: Number(process.env.EXPERT_REPLAY_WORK ?? 128),
        seeds: (process.env.EXPERT_REPLAY_SEEDS ?? '1005,1006,1007')
          .split(',')
          .map(Number),
        sourceHashes: Object.fromEntries(
          sourceFiles.map((file) => [
            path.relative(process.cwd(), path.resolve(file)),
            createHash('sha256').update(fs.readFileSync(file)).digest('hex')
          ])
        )
      },
      null,
      2
    )
  )
  result = spawnSync(
    process.execPath,
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      ...jobs.map((j) => j.test),
      '--reporter=verbose',
      '--maxWorkers=2'
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        EXPERT_REPLAY_OUTPUT: output,
        EXPERT_REPLAY_BASELINE: baseline
      }
    }
  )
  const rows = jobs.flatMap((j) =>
    fs
      .readFileSync(path.join(j.directory, 'results.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse)
  )
  fs.writeFileSync(
    path.join(output, 'results.jsonl'),
    rows.map(JSON.stringify).join('\n') + '\n'
  )
} finally {
  // Only files successfully created with wx by this invocation are removed.
  for (const file of created.reverse()) fs.unlinkSync(file)
}
if (result?.error) throw result.error
process.exitCode = result?.status ?? 1
