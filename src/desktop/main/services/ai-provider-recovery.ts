import { setTimeout as delay } from 'node:timers/promises'
import { AiRequestError, type JsonObject } from '../../contracts/ipc/ai'
import {
  redactDiagnosticText,
  providerFailure,
  type Post,
  type TransportProgress
} from './ai-transport'

const transientCodes = new Set([429, 500, 502, 503, 504, 529])
const transientTypes = new Set([
  'server',
  'server_error',
  'provider_error',
  'rate_limit_exceeded',
  'rate_limited',
  'overloaded',
  'provider_overloaded',
  'provider_unavailable'
])

function retryable(details: JsonObject): boolean {
  const providerCode = Number(details.providerErrorCode)
  const code =
    providerCode >= 400 && providerCode <= 599
      ? providerCode
      : Number(details.httpStatus)
  const type = details.providerErrorType
  // Explicit permanent classifications override a generic finish_reason:error.
  if (code >= 400 && code < 500 && code !== 429) return false
  if (typeof type === 'string') return transientTypes.has(type)
  if (Number.isFinite(code) && code >= 400) return transientCodes.has(code)
  return details.failureKind === 'network' || details.finishReason === 'error'
}

/** Same serialized request, at most three attempts, within the original call deadline. */
export function withProviderRecovery(post: Post, callId: string, phase: string): Post {
  return async (url, body, headers, apiKey, signal, report, timeoutMs) => {
    const started = performance.now()
    const diagnostic = (
      stage: TransportProgress['stage'],
      attempt: number,
      data: JsonObject
    ) =>
      report({
        stage,
        recovery: {
          callId,
          phase,
          attempt,
          totalDurationMs: performance.now() - started,
          ...data
        }
      })
    for (let attempt = 1; ; attempt++) {
      signal.throwIfAborted()
      const attemptStarted = performance.now()
      diagnostic('transport-started', attempt, {})
      let response: unknown
      const transportDetails: Record<string, string | number> = {}
      try {
        response = await post(
          url,
          body,
          headers,
          apiKey,
          signal,
          (progress) => {
            for (const field of [
              'retryAfterMs',
              'httpStatus',
              'providerRequestId'
            ] as const) {
              const value = progress[field]
              if (value !== undefined) transportDetails[field] = value
            }
            report({ ...progress, recovery: { callId, phase, attempt } })
          },
          Math.max(1, timeoutMs - (performance.now() - started))
        )
        signal.throwIfAborted()
        const data = response as {
          error?: unknown
          choices?: {
            finish_reason?: string
            error?: unknown
            message?: { refusal?: string }
          }[]
          usage?: JsonObject
        } | null
        if (data?.choices?.[0]?.message?.refusal) return response
        if (
          data?.error ||
          data?.choices?.[0]?.error ||
          data?.choices?.[0]?.finish_reason === 'error'
        ) {
          // Keep numeric usage only; it is diagnostic, never a reason to accept partial output.
          const usage: Record<string, number> = {}
          for (const key of [
            'prompt_tokens',
            'completion_tokens',
            'total_tokens',
            'cost'
          ]) {
            const value = data.usage?.[key]
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
              usage[key] = value
          }
          const tokenDetails: Record<string, JsonObject> = {}
          for (const [field, names] of [
            ['prompt_tokens_details', ['cached_tokens', 'cache_write_tokens']],
            ['completion_tokens_details', ['reasoning_tokens']]
          ] as const) {
            const source = data.usage?.[field]
            if (source && typeof source === 'object' && !Array.isArray(source)) {
              const counters: Record<string, number> = {}
              for (const name of names) {
                const value = (source as JsonObject)[name]
                if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
                  counters[name] = value
              }
              tokenDetails[field] = counters
            }
          }
          throw new AiRequestError('AI provider interrupted its response.', {
            failureKind: 'provider-response',
            repairable: false,
            finishReason: data.choices?.[0]?.finish_reason ?? null,
            ...providerFailure(data, apiKey),
            usage: { ...usage, ...tokenDetails }
          })
        }
        if (attempt > 1) diagnostic('recovery-complete', attempt, {})
        return response
      } catch (error) {
        if (signal.aborted) throw signal.reason
        const failureDetails =
          error instanceof AiRequestError
            ? (error.details ?? {})
            : { failureKind: 'network', repairable: false }
        const details: JsonObject = { ...transportDetails, ...failureDetails }
        const canRetry = retryable(details)
        diagnostic('attempt-failed', attempt, {
          ...details,
          errorMessage: redactDiagnosticText(
            error instanceof Error ? error.message : String(error),
            apiKey
          ).slice(0, 2000),
          retryable: canRetry,
          attemptDurationMs: performance.now() - attemptStarted
        })
        const retryAfter =
          typeof details.retryAfterMs === 'number' ? details.retryAfterMs : 0
        const waitMs = Math.max(attempt * 500, retryAfter)
        const remaining = timeoutMs - (performance.now() - started)
        if (!canRetry || attempt >= 3 || waitMs + 1000 >= remaining) {
          if (canRetry) diagnostic('recovery-exhausted', attempt, {})
          throw new AiRequestError(
            redactDiagnosticText(
              error instanceof Error ? error.message : String(error),
              apiKey
            ).slice(0, 2000),
            {
              ...details,
              retryable: canRetry,
              recoveryAttempts: attempt,
              recoveryDurationMs: performance.now() - started
            }
          )
        }
        diagnostic('retry-scheduled', attempt, { delayMs: waitMs })
        await delay(waitMs, undefined, { signal })
        if (performance.now() - started >= timeoutMs) {
          diagnostic('recovery-exhausted', attempt, {})
          throw new AiRequestError('AI recovery deadline exhausted.', {
            ...details,
            repairable: false,
            recoveryAttempts: attempt
          })
        }
      }
    }
  }
}
