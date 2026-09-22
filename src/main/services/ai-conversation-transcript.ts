import type { JsonObject, JsonValue } from '../../shared/ipc/ai'
import type { MatchLogRecord } from '../../shared/ipc/match-logs'

const object = (value: JsonValue | undefined): JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
const label = (value: string): string =>
  value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('-', ' ')

/** A readable projection of recorded AI inputs; never reads the private match state. */
export class AiConversationTranscript {
  private systemWritten = false
  private requestId = ''
  private readonly names = new Map<string, string>()

  private learn(value: JsonValue | undefined): void {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      value.forEach((v) => this.learn(v))
      return
    }
    const entry = object(value)
    const ref = entry.ref ?? entry.id
    if (typeof ref === 'string' && typeof entry.name === 'string')
      this.names.set(ref, entry.name)
    Object.values(entry).forEach((v) => this.learn(v))
    if (typeof entry.instanceId === 'string' && typeof entry.cardId === 'string')
      this.names.set(entry.instanceId, this.names.get(entry.cardId) ?? entry.cardId)
  }

  private readable(value: JsonValue | undefined, indent = '', field = ''): string {
    if (value === null || value === undefined) return 'none'
    if (typeof value !== 'object') {
      const text = String(value)
      return this.names.has(text) ? `${this.names.get(text)} [${text}]` : text
    }
    if (Array.isArray(value))
      return value.length
        ? value.map((v) => `${indent}- ${this.readable(v, indent + '  ')}`).join('\n')
        : 'none'
    if (
      ['cards', 'graveyard', 'answer'].includes(field) &&
      Object.values(value).every((count) => typeof count === 'number')
    )
      return (
        Object.entries(value)
          .map(([name, count]) => `${name} (${count})`)
          .join(', ') || 'none'
      )
    if (field === 'positions')
      return Object.entries(value)
        .map(([position, id]) => `${position}→${id}`)
        .join(', ')
    return (
      Object.entries(value)
        .filter(
          ([key, nested]) =>
            nested !== null &&
            (nested !== false ||
              ['canAttackNow', 'canAttackHeroNow', 'available'].includes(key)) &&
            !(Array.isArray(nested) && !nested.length) &&
            !(nested && typeof nested === 'object' && !Object.keys(nested).length)
        )
        .map(
          ([key, nested]) =>
            `${indent}${label(key)}: ${this.readable(nested, indent + '  ', key)}`
        )
        .join('\n') || 'none'
    )
  }

  format(record: MatchLogRecord): string {
    if (record.stream !== 'decisions') return ''
    const d = record.data
    const heading = `\nTURN ${record.turnNumber ?? 0} - ${record.kind.toUpperCase().replaceAll('-', ' ')}\n${record.timestamp} | Request ${record.decisionId ?? 'none'}\n`
    switch (record.kind) {
      case 'request-progress':
        if (
          d.recovery &&
          [
            'attempt-failed',
            'retry-scheduled',
            'recovery-complete',
            'recovery-exhausted'
          ].includes(String(d.stage))
        )
          return `${record.timestamp} | Request ${record.decisionId ?? 'none'} | ${d.stage}: ${JSON.stringify(d.recovery)}\n`
        return (
          `${record.timestamp} | Request ${record.decisionId ?? 'none'} | ` +
          `Transport: ${d.stage}. Elapsed: ${(Number(d.elapsedMs) / 1000).toFixed(1)}s.` +
          (d.lastStage ? ` Last milestone: ${d.lastStage}.` : '') +
          (d.receivedBytes !== undefined
            ? ` Received: ${d.receivedBytes} bytes.`
            : '') +
          (d.httpStatus !== undefined ? ` HTTP: ${d.httpStatus}.` : '') +
          (d.providerRequestId ? ` Provider request: ${d.providerRequestId}.` : '') +
          '\n'
        )
      case 'request-started': {
        const messages = object(d.request).messages
        if (!Array.isArray(messages)) return heading + 'Request context unavailable.\n'
        let text = ''
        if (!this.systemWritten) {
          const system = messages.map(object).find((m) => m.role === 'system')
          if (typeof system?.content === 'string') {
            const lines = system.content.split('\n')
            text += '\nINITIAL INSTRUCTIONS\n' + lines[0] + '\n'
            for (const line of lines.slice(1)) {
              try {
                const data = JSON.parse(line) as JsonValue
                this.learn(data)
                text += this.readable(data) + '\n'
              } catch {
                text += line + '\n'
              }
            }
            this.systemWritten = true
          }
        }
        text +=
          heading +
          `Provider: ${d.provider}. Model: ${d.modelId}. Reasoning: ${d.reasoningEffort}. Phase: ${d.phase ?? 'action'}.\n`
        const latest = object(messages.at(-1))
        let facts: JsonObject
        try {
          facts = object(JSON.parse(String(latest.content)) as JsonValue)
        } catch {
          return text + 'Context could not be rendered.\n'
        }
        this.learn(facts)
        this.learn(facts) // Definitions may follow their instance references.
        if (this.requestId !== record.decisionId) {
          this.requestId = record.decisionId ?? ''
          text += '\nCONTEXT RECEIVED\n' + this.readable(facts.state) + '\n'
          text +=
            '\nSINCE THE PREVIOUS DECISION\n' +
            this.readable(facts.eventsSincePreviousDecision) +
            '\n'
          text +=
            '\nPREVIOUS EXECUTION RESULTS\n' +
            this.readable(facts.actualActionResults) +
            '\n'
          text +=
            '\nAVAILABLE INPUTS (positions are zero-based)\n' +
            this.readable(facts.actions) +
            '\n'
        } else
          text +=
            'Same board context and available inputs; the answers below were added.\n'
        if (Array.isArray(facts.information) && facts.information.length)
          text += '\nINFORMATION SUPPLIED\n' + this.readable(facts.information) + '\n'
        if (facts.turnPlan)
          text += '\nCURRENT TURN PLAN\n' + this.readable(facts.turnPlan) + '\n'
        for (const field of [
          'proposedAction',
          'relevantFacts',
          'previousExpectation',
          'observedCorrections',
          'recentPublicEvents',
          'currentDecision',
          'outcomeReviews',
          'instructionNote'
        ])
          if (facts[field])
            text +=
              '\n' +
              label(field).toUpperCase() +
              '\n' +
              this.readable(facts[field]) +
              '\n'
        return (
          text +
          `\nINSTRUCTION\n${facts.instruction ?? ''}\nRetained conversation exchanges: ${d.retainedExchanges ?? 0}.\n`
        )
      }
      case 'response-received': {
        const choice = object(d.choice)
        const output =
          'AI DECISION\n' +
          this.readable(d.selectedAction ?? choice) +
          '\nEXPECTED RESULT\n' +
          this.readable(choice.expectedResult)
        return (
          heading +
          output +
          `\n\nAI EXPLANATION\n${d.reason ?? 'None provided.'}\n\nResponse time: ${(Number(d.durationMs) / 1000).toFixed(1)} seconds.\n`
        )
      }
      case 'action-executed':
        return (
          heading +
          `RESULT: ${d.accepted ? 'Accepted' : 'Rejected'}.\nSource: ${d.source === 'forced' ? 'Only legal input; no AI request needed' : d.source === 'safe-fallback' ? 'Deterministic End Turn safety fallback' : d.source === 'random-timeout' || d.source === 'random-fallback' ? 'Random fallback, not an AI decision' : 'AI decision'}.\n` +
          this.readable(d.command) +
          '\n' +
          (d.accepted ? '' : `${d.message ?? d.reason ?? ''}\n`) +
          '\nOBSERVED RESULTS\n' +
          this.readable(d.rawEvents) +
          '\n'
        )
      case 'failure':
        return (
          heading +
          `AI REQUEST FAILED\n${d.reason}\n` +
          (d.source === 'paused'
            ? 'Match paused. No random fallback move was played. See execution records for completed actions.\n'
            : `Fallback selection:\n${this.readable(d.command)}\nExecution is recorded separately.\n`) +
          (d.diagnostics ? this.readable(d.diagnostics) + '\n' : '')
        )
      case 'turn-plan':
        return (
          heading +
          `TURN PLAN (not executed)\n${this.readable(d.choice)}\n${d.reason}\n` +
          `Duration: ${d.durationMs}ms. Usage: ${JSON.stringify(d.usage ?? {})}\n`
        )
      case 'plan-challenge':
        return (
          heading +
          'PLAN CHALLENGE (no action executed)\n' +
          this.readable(d.proposedAction) +
          '\nRELEVANT FACTS\n' +
          this.readable(d.relevantFacts) +
          '\nREQUESTED FACTS\n' +
          this.readable(d.information) +
          '\n'
        )
      case 'fact-inspection':
        return (
          heading +
          'FACTUAL INSPECTION (no action executed)\n' +
          this.readable(d.choice) +
          '\nANSWERS\n' +
          this.readable(d.information) +
          `\nExtra exchanges used this turn: ${d.extraExchangesUsed}.\nDuration: ${d.durationMs}ms.\n`
        )
      case 'plan-updated':
        return heading + 'REVISED PLAN\n' + this.readable(d.turnPlan) + '\n'
      case 'timeout-retry':
        return (
          heading +
          `TIMEOUT RETRY ${d.timeoutRetryCount}\n${d.reason}\n` +
          this.readable(d.diagnostics) +
          '\n'
        )
      case 'timeout-fallback':
        return (
          heading +
          `TIMEOUT RANDOM FALLBACK\n${d.reason}\n${this.readable(d.command)}\nExecution is recorded separately.\n`
        )
      case 'manual-retry':
        return heading + `MANUAL RETRY\n${d.reason}\n`
      case 'response-rejected':
        return (
          heading +
          `REJECTED RESPONSE\n${d.reason}\n` +
          this.readable(d.diagnostics) +
          '\n'
        )
      case 'fresh-context-retry':
        return (
          heading +
          `FRESH CONTEXT RETRY\n${d.reason}\nConversation reset; current fair facts and observed outcomes retained. No move executed.\n`
        )
      case 'end-turn-review':
        return (
          heading + 'END TURN REVIEW (no action executed)\n' + this.readable(d) + '\n'
        )
      case 'format-repair':
        return (
          heading +
          `FORMAT CORRECTION ${d.repairCount}\n${d.instruction}\nSame board and legal actions; no move executed.\n`
        )
      case 'request-superseded':
      case 'cancelled':
        return heading + `${d.reason}. No AI move applied from this request.\n`
      case 'history-trim':
        return (
          heading +
          'Older conversation entries were removed from the model context; current facts remain.\n' +
          this.readable(d) +
          '\n'
        )
      default:
        return ''
    }
  }
}
