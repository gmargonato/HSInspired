import { ipcMain } from 'electron'
import {
  AI_IPC_CHANNELS,
  aiIpcFailure,
  aiIpcSuccess,
  parseAiDeckPlanRequest,
  parseAiMatchupPlanRequest,
  parseAiDecisionRequest,
  type AiIpcResult
} from '../../shared/ipc/ai'
import { AzureOpenAiDecisionService } from './azure-openai-ai-service'

export function registerAiIpc(service: AzureOpenAiDecisionService): void {
  const settle = async <T>(operation: () => Promise<T>): Promise<AiIpcResult<T>> => {
    try {
      return aiIpcSuccess(await operation())
    } catch (error) {
      return aiIpcFailure(error)
    }
  }

  ipcMain.handle(AI_IPC_CHANNELS.decide, (_event, request: unknown) =>
    settle(() => service.decide(parseAiDecisionRequest(request)))
  )
  ipcMain.handle(AI_IPC_CHANNELS.planDeck, (_event, request: unknown) =>
    settle(() => service.planDeck(parseAiDeckPlanRequest(request)))
  )
  ipcMain.handle(AI_IPC_CHANNELS.planMatchup, (_event, request: unknown) =>
    settle(() => service.planMatchup(parseAiMatchupPlanRequest(request)))
  )
}
