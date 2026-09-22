const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(process.cwd(), 'artifacts', 'match-logs')

function increment(map, key, amount = 1) {
  map[key] = (map[key] || 0) + amount
}

function classifyRejection(reason) {
  const text = String(reason || '').toLowerCase()
  if (text.includes('action id') || text.includes('intent')) return 'intent-mismatch'
  if (
    text.includes('format') ||
    text.includes('character') ||
    text.includes('field') ||
    text.includes('schema')
  )
    return 'format'
  if (
    text.includes('timeout') ||
    text.includes('network') ||
    text.includes('provider') ||
    text.includes('abort')
  )
    return 'transport'
  return 'other'
}

function readLogs() {
  if (!fs.existsSync(root)) return []
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'ai.json'))
    .filter((file) => fs.existsSync(file))
    .flatMap((file) => {
      try {
        return [JSON.parse(fs.readFileSync(file, 'utf8'))]
      } catch {
        return []
      }
    })
}

const logs = readLogs()
const statuses = {}
const models = {}
const kinds = {}
const rejectionKinds = {}
const actionTypes = {}
const responseFinishReasons = {}
const executedSources = {}
const failureKinds = {}
const responseDurations = []
const providerResponseDurations = []
let executedActions = 0
let responses = 0
let providerResponses = 0
let localResponses = 0
let rejectedResponses = 0

for (const match of logs) {
  increment(statuses, match.status || 'unknown')
  if (match.model) increment(models, match.model)
  for (const decision of match.decisions || []) {
    increment(kinds, decision.kind || 'unknown')
    if (decision.kind === 'response-received') {
      responses++
      increment(responseFinishReasons, decision.finishReason || 'unknown')
      const isLocal =
        decision.finishReason === 'local-search' ||
        decision.modelId === 'hardware-local-v1'
      if (isLocal) localResponses++
      else providerResponses++
      if (
        typeof decision.durationMs === 'number' &&
        Number.isFinite(decision.durationMs)
      ) {
        responseDurations.push(decision.durationMs)
        if (!isLocal) providerResponseDurations.push(decision.durationMs)
      }
    }
    if (decision.kind === 'action-executed') {
      executedActions++
      increment(executedSources, decision.source || 'unknown')
      const type = decision.command?.type || decision.selectedCommand?.type
      if (type) increment(actionTypes, type)
    }
    if (decision.kind === 'response-rejected') {
      rejectedResponses++
      increment(rejectionKinds, classifyRejection(decision.reason))
    }
    if (decision.kind === 'failure' || decision.kind === 'timeout-fallback')
      increment(failureKinds, decision.kind)
  }
}

const averageResponseMs = responseDurations.length
  ? Math.round(
      (responseDurations.reduce((sum, value) => sum + value, 0) /
        responseDurations.length) *
        100
    ) / 100
  : null
const averageProviderResponseMs = providerResponseDurations.length
  ? Math.round(
      (providerResponseDurations.reduce((sum, value) => sum + value, 0) /
        providerResponseDurations.length) *
        100
    ) / 100
  : null

const result = {
  source: path.relative(process.cwd(), root) || root,
  matches: logs.length,
  statuses,
  models,
  decisionKinds: kinds,
  rejectedResponses,
  rejectionKinds,
  responseFinishReasons,
  executedSources,
  failureKinds,
  responses,
  averageResponseMs,
  averageProviderResponseMs,
  localResponses,
  providerResponses,
  executedActions,
  executedActionTypes: actionTypes
}

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
} else {
  console.log(`AI corpus: ${result.matches} matches from ${result.source}`)
  console.log(`Statuses: ${JSON.stringify(statuses)}`)
  console.log(`Models: ${JSON.stringify(models)}`)
  console.log(
    `Actions: ${executedActions} executed; ${responses} responses (${providerResponses} provider, ${localResponses} local); ${rejectedResponses} rejected responses`
  )
  console.log(`Executed action types: ${JSON.stringify(actionTypes)}`)
  console.log(`Rejection categories: ${JSON.stringify(rejectionKinds)}`)
  console.log(`Response finishes: ${JSON.stringify(responseFinishReasons)}`)
  console.log(`Executed sources: ${JSON.stringify(executedSources)}`)
  console.log(`Failure signals: ${JSON.stringify(failureKinds)}`)
  console.log(
    `Average response: ${averageResponseMs === null ? 'n/a' : averageResponseMs + 'ms'}`
  )
  console.log(
    `Average provider response: ${averageProviderResponseMs === null ? 'n/a' : averageProviderResponseMs + 'ms'}`
  )
}
