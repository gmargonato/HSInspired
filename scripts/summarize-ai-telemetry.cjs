const fs = require('node:fs')
const path = require('node:path')

// Read-only: accepts a match directory, ai.json, or the complete match-log directory.
function files(root) {
  if (!fs.existsSync(root)) return []
  if (fs.statSync(root).isFile()) return path.basename(root) === 'ai.json' ? [root] : []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() || entry.name === 'ai.json'
        ? files(path.join(root, entry.name))
        : []
    )
}
function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const percentile = (p) =>
    sorted.length ? Math.round(sorted[Math.ceil(sorted.length * p) - 1]) : null
  return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95) }
}
const groups = new Map()
const inputs = files(process.argv[2] ?? path.join('artifacts', 'match-logs'))
for (const file of inputs) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  let key = 'unknown'
  for (const row of document.decisions ?? []) {
    if (row.kind === 'request-started') {
      key = `${row.provider}/${row.modelId}/${row.reasoningEffort}`
    }
    if (!groups.has(key))
      groups.set(key, {
        requests: 0,
        outcomes: {},
        timing: [],
        usage: [],
        failedMs: [],
        retries: 0,
        recovered: 0,
        exhausted: 0,
        manual: 0,
        recoveryMs: []
      })
    const group = groups.get(key)
    if (row.kind === 'manual-retry') group.manual++
    if (row.kind === 'request-progress') {
      if (row.stage === 'attempt-failed') {
        group.failedMs.push(row.recovery?.attemptDurationMs)
        if (row.recovery?.usage) group.usage.push(row.recovery.usage)
      }
      if (row.stage === 'retry-scheduled') group.retries++
      if (row.stage === 'recovery-complete') group.recovered++
      if (row.stage === 'recovery-exhausted') group.exhausted++
      if (['recovery-complete', 'recovery-exhausted'].includes(row.stage))
        group.recoveryMs.push(row.recovery?.totalDurationMs)
    }
    if (row.kind === 'request-progress' && row.stage === 'transport-started')
      group.requests++
    if (
      ['turn-plan', 'response-received', 'fact-inspection', 'end-turn-review'].includes(
        row.kind
      )
    ) {
      const phase = row.kind === 'turn-plan' ? 'plan' : 'action'
      ;(group.outcomes[phase] ??= []).push(row.durationMs)
    }
    if (row.kind === 'decision-timing') group.timing.push(row)
    // Each completed/rejected response is counted once, excluding echoed terminal failures.
    if (
      [
        'turn-plan',
        'response-received',
        'fact-inspection',
        'end-turn-review',
        'response-rejected'
      ].includes(row.kind)
    ) {
      group.usage.push(row.usage ?? row.diagnostics?.usage ?? {})
    }
  }
}
const summary = [...groups].map(([providerModelEffort, group]) => {
  const known = (field) =>
    group.usage.map(field).filter((n) => typeof n === 'number' && Number.isFinite(n))
  const tokens = (field) => {
    const values = known(field)
    return {
      reportedResponses: values.length,
      tokens: values.length ? values.reduce((a, b) => a + b, 0) : null
    }
  }
  return {
    providerModelEffort,
    transportCalls: group.requests,
    recovery: {
      additionalAttemptsScheduled: group.retries,
      providerCallsRecovered: group.recovered,
      exhausted: group.exhausted,
      manualRetries: group.manual,
      failedAttemptTimeMs: group.failedMs.length
        ? group.failedMs.filter(Number.isFinite).reduce((a, b) => a + b, 0)
        : null,
      duration: distribution(group.recoveryMs)
    },
    successfulRequestDuration: Object.fromEntries(
      Object.entries(group.outcomes).map(([phase, values]) => [
        phase,
        distribution(values)
      ])
    ),
    decisionMs: distribution(group.timing.map((r) => r.decisionMs)),
    presentationMs: distribution(group.timing.map((r) => r.presentationMs)),
    overlapMs: distribution(group.timing.map((r) => r.presentationOverlapMs)),
    visibleWaitMs: distribution(group.timing.map((r) => r.visibleWaitMs)),
    input: tokens((u) => u.prompt_tokens),
    cachedInput: tokens((u) => u.prompt_tokens_details?.cached_tokens),
    output: tokens((u) => u.completion_tokens),
    reasoning: tokens((u) => u.completion_tokens_details?.reasoning_tokens)
  }
})
console.log(
  JSON.stringify(
    {
      matches: inputs.length,
      note: 'Missing measurements are null, not zero. Successful call durations include automatic recovery. Failed-attempt time is also reported separately, not additive to call duration. Token totals count recorded failed attempts and successful/rejected completions once. Older logs lack attempt diagnostics. Overlap includes presentation pacing.',
      groups: summary
    },
    null,
    2
  )
)
