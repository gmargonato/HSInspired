import { ipcMain } from 'electron'
import {
  AI_IPC_CHANNELS,
  aiIpcFailure,
  aiIpcSuccess,
  parseAiDeckPlanRequest,
  parseAiDecisionRequest,
  type AiIpcResult
} from '../../shared/ipc/ai'
import { AzureOpenAiDecisionService } from './azure-openai-ai-service'
import type { MatchLogRepository } from './match-log-repository'

export function registerAiIpc(
  service: AzureOpenAiDecisionService,
  logs?: MatchLogRepository
): void {
  const settle = async <T>(
    owner: number,
    request: { logMatchId?: string; requestId: string },
    operation: () => Promise<T>
  ): Promise<AiIpcResult<T>> => {
    const startedAt = performance.now()
    if (request.logMatchId) logs?.assertOwner(request.logMatchId, owner)
    try {
      return aiIpcSuccess(await operation())
    } catch (error) {
      if (request.logMatchId) {
        const message = error instanceof Error ? error.message : String(error)
        void logs
          ?.append(request.logMatchId, {
            stream: 'decisions',
            kind: 'provider-failure',
            timestamp: new Date().toISOString(),
            decisionId: request.requestId,
            data: {
              error: message,
              timeout: /timed out|deadline.*elapsed/i.test(message),
              durationMs: performance.now() - startedAt
            }
          })
          .catch((logError) => console.error('Failed to record AI failure:', logError))
      }
      return aiIpcFailure(error)
    }
  }

  ipcMain.handle(AI_IPC_CHANNELS.decide, (event, value: unknown) => {
    const request = parseAiDecisionRequest(value)
    return settle(event.sender.id, request, () => service.decide(request))
  })
  ipcMain.handle(AI_IPC_CHANNELS.planDeck, (event, value: unknown) => {
    const request = parseAiDeckPlanRequest(value)
    return settle(event.sender.id, request, () => service.planDeck(request))
  })
}
