import { request as httpsRequest } from 'node:https'
import type { TLSSocket } from 'node:tls'
import {
  AiRequestError,
  type AiRequestStage,
  type JsonObject
} from '../../contracts/ipc/ai'

const MAX_DIAGNOSTIC_CHARS = 16_000
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

export function redactDiagnosticText(text: string, apiKey: string): string {
  return (apiKey ? text.replaceAll(apiKey, '[redacted]') : text)
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(
      /("(?:api[-_]?key|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[redacted]"'
    )
}

export function rejectedContent(content: unknown, apiKey: string): JsonObject {
  const text = redactDiagnosticText(
    typeof content === 'string' ? content : JSON.stringify(content ?? null),
    apiKey
  )
  return {
    rejectedContent: text.slice(0, MAX_DIAGNOSTIC_CHARS),
    contentTruncated: text.length > MAX_DIAGNOSTIC_CHARS
  }
}

/** Extract only diagnostic fields, never the provider's arbitrary metadata/payload. */
export function providerFailure(value: unknown, apiKey: string): JsonObject {
  const data =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined
  const errorValue =
    data.error ??
    (firstChoice && typeof firstChoice === 'object' ? firstChoice.error : undefined)
  const error =
    errorValue && typeof errorValue === 'object'
      ? (errorValue as Record<string, unknown>)
      : {}
  const metadata =
    error.metadata && typeof error.metadata === 'object'
      ? (error.metadata as Record<string, unknown>)
      : {}
  const result: Record<string, string | number> = {}
  for (const [key, value] of Object.entries({
    providerErrorCode: error.code,
    providerNativeCode: metadata.provider_code,
    providerErrorType: metadata.error_type ?? error.type,
    providerErrorMessage: error.message,
    generationId: data.id,
    providerName: data.provider ?? metadata.provider_name
  })) {
    if (typeof value === 'string')
      result[key] = redactDiagnosticText(value, apiKey).slice(0, 1000)
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  return result
}

export type TransportProgress = {
  recovery?: JsonObject
  retryAfterMs?: number
  stage: AiRequestStage
  receivedBytes?: number
  httpStatus?: number
  providerRequestId?: string
}
export type Post = (
  url: URL,
  body: string,
  headers: Readonly<Record<string, string>>,
  apiKey: string,
  signal: AbortSignal,
  progress: (value: TransportProgress) => void,
  timeoutMs: number
) => Promise<unknown>

/** A wall-clock deadline also stops providers that keep sending whitespace. */
export const post: Post = (url, body, headers, apiKey, signal, progress, timeoutMs) =>
  new Promise((resolve, reject) => {
    let deadline: ReturnType<typeof setTimeout> | undefined = undefined
    let settled = false
    const finish = (error: unknown, value?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      signal.removeEventListener('abort', cancel)
      if (error) reject(error)
      else resolve(value)
    }
    const fail = (
      kind: string,
      message: string,
      details: JsonObject = {}
    ): AiRequestError =>
      new AiRequestError(message, { failureKind: kind, repairable: false, ...details })
    const request = httpsRequest(
      url,
      { method: 'POST', agent: false, headers },
      (response) => {
        const requestId =
          response.headers['x-request-id'] ?? response.headers['apim-request-id']
        const retryHeader = response.headers['retry-after']
        const retryValue = typeof retryHeader === 'string' ? retryHeader : ''
        const retryAfterMs = retryValue.trim()
          ? Number.isFinite(Number(retryValue))
            ? Number(retryValue) * 1000
            : Date.parse(retryValue) - Date.now()
          : NaN
        progress({
          stage: 'response-headers',
          ...(Number.isFinite(retryAfterMs)
            ? { retryAfterMs: Math.max(0, retryAfterMs) }
            : {}),
          httpStatus: response.statusCode,
          ...(typeof requestId === 'string'
            ? {
                providerRequestId: redactDiagnosticText(requestId, apiKey).slice(0, 200)
              }
            : {})
        })
        const chunks: Buffer[] = []
        let receivedBytes = 0
        response.on('data', (chunk: Buffer) => {
          if (settled) return
          receivedBytes += chunk.length
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            finish(
              fail('response-too-large', 'AI provider response exceeded 4 MiB.', {
                receivedBytes
              })
            )
            response.destroy()
            request.destroy()
            return
          }
          chunks.push(chunk)
          progress({ stage: 'response-body', receivedBytes })
        })
        response.on('error', networkError)
        response.on('aborted', () =>
          networkError(new Error('AI provider response was interrupted.'))
        )
        response.on('end', () => {
          if (settled) return
          progress({ stage: 'response-complete', receivedBytes })
          const text = Buffer.concat(chunks).toString('utf8')
          if (
            !response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            let envelope: unknown
            try {
              envelope = JSON.parse(text)
            } catch {
              /* Non-JSON HTTP errors remain diagnostic text. */
            }
            finish(
              fail('provider-http', 'AI provider HTTP ' + response.statusCode + '.', {
                httpStatus: response.statusCode ?? null,
                ...providerFailure(envelope, apiKey),
                ...(Number.isFinite(retryAfterMs)
                  ? { retryAfterMs: Math.max(0, retryAfterMs) }
                  : {}),
                ...rejectedContent(text, apiKey)
              })
            )
            return
          }
          try {
            finish(null, JSON.parse(text))
          } catch {
            finish(
              fail(
                'provider-json',
                'AI provider returned invalid JSON.',
                rejectedContent(text, apiKey)
              )
            )
          }
        })
      }
    )
    function networkError(error: Error): void {
      finish(
        fail(
          'network',
          redactDiagnosticText(error.message, apiKey).slice(0, MAX_DIAGNOSTIC_CHARS)
        )
      )
    }
    function cancel(): void {
      finish(signal.reason ?? new Error('AI request cancelled.'))
      request.destroy()
    }
    request.on('error', networkError)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) {
      cancel()
      return
    }
    deadline = setTimeout(() => {
      finish(
        fail('timeout', 'AI provider exceeded the request deadline.', { timeoutMs })
      )
      request.destroy()
    }, timeoutMs)
    deadline.unref()
    request.on('socket', (socket) => {
      progress({ stage: 'socket-assigned' })
      socket.once('lookup', (error) => {
        if (!error) progress({ stage: 'dns-resolved' })
      })
      socket.once('connect', () => progress({ stage: 'tcp-connected' }))
      ;(socket as TLSSocket).once('secureConnect', () =>
        progress({ stage: 'tls-connected' })
      )
    })
    request.once('finish', () => progress({ stage: 'request-sent' }))
    request.end(body)
  })
