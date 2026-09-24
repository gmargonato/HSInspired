import type { JsonObject, JsonValue } from '../../shared/ipc/ai'
import type { MatchLogRecord } from '../../shared/ipc/match-logs'

/** Full payloads are opt-in; ai.json retains compact diagnostics. */
export class AiLog {
  constructor(private readonly document: Record<string, JsonValue>) {}
  accept(record: MatchLogRecord): void {
    if (record.stream !== 'decisions') return
    const data = record.data
    if (
      ![
        'request-started',
        'decision-timing',
        'request-progress',
        'request-superseded',
        'response-received',
        'response-rejected',
        'format-repair',
        'fresh-context-retry',
        'end-turn-review',
        'timeout-retry',
        'timeout-fallback',
        'manual-retry',
        'turn-plan',
        'plan-challenge',
        'fact-inspection',
        'plan-updated',
        'action-executed',
        'failure',
        'cancelled',
        'history-trim'
      ].includes(record.kind)
    )
      return
    if (record.kind === 'request-progress') {
      ;(this.document.decisions as JsonValue[]).push({
        kind: record.kind,
        timestamp: record.timestamp,
        revision: record.revision ?? null,
        turn: record.turnNumber ?? 0,
        requestId: record.decisionId ?? '',
        stage: data.stage ?? null,
        recovery: data.recovery ?? null,
        lastStage: data.lastStage ?? null,
        elapsedMs: data.elapsedMs ?? null,
        receivedBytes: data.receivedBytes ?? null,
        httpStatus: data.httpStatus ?? null,
        providerRequestId: data.providerRequestId ?? null
      })
      return
    }
    if (record.kind === 'response-received' && typeof data.modelId === 'string') {
      const modelsUsed = Array.isArray(this.document.modelsUsed)
        ? this.document.modelsUsed.filter(
            (model): model is string => typeof model === 'string'
          )
        : []
      if (!modelsUsed.includes(data.modelId)) modelsUsed.push(data.modelId)
      this.document.modelsUsed = modelsUsed
      this.document.model = modelsUsed.length === 1 ? modelsUsed[0]! : 'multiple'
    }
    const summary: JsonObject = {
      kind: record.kind,
      timestamp: record.timestamp,
      revision: record.revision ?? null,
      provider: data.provider ?? null,
      reasoningEffort: data.reasoningEffort ?? null,
      modelId: data.modelId ?? null,
      actions: data.actions ?? null,
      actionCount: data.actionCount ?? null,
      contextBytes: data.contextBytes ?? null,
      retainedExchanges: data.retainedExchanges ?? null,
      requestId: record.decisionId ?? '',
      turn: record.turnNumber ?? 0,
      source: data.source ?? null,
      actionId: data.actionId ?? null,
      command: data.command ?? null,
      choice: data.choice ?? null,
      reason: data.reason ?? null,
      accepted: data.accepted ?? null,
      durationMs: data.durationMs ?? null,
      finishReason: data.finishReason ?? null,
      usage: data.usage ?? null,
      ...(data.diagnostics ? { diagnostics: data.diagnostics } : {}),
      ...(data.repairCount !== undefined ? { repairCount: data.repairCount } : {}),
      ...(data.timeoutRetryCount !== undefined
        ? { timeoutRetryCount: data.timeoutRetryCount }
        : {}),
      ...(data.phase !== undefined ? { phase: data.phase } : {}),
      ...Object.fromEntries(
        [
          'allowInspection',
          'decisionMs',
          'presentationOverlapMs',
          'visibleWaitMs',
          'presentationMs',
          'freshContext',
          'currentDecision',
          'extraExchangesUsed',
          'information',
          'relevantFacts',
          'proposedAction',
          'turnPlan',
          'expectedResult'
        ]
          .filter((key) => data[key] !== undefined)
          .map((key) => [key, data[key]])
      ),
      ...(record.kind === 'format-repair'
        ? { instruction: data.instruction ?? null }
        : {})
    }
    ;(this.document.decisions as JsonValue[]).push(summary)
  }
}
