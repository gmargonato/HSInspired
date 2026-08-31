import { ipcMain } from 'electron'
import {
  AI_IPC_CHANNELS,
  parseAiDeckPlanRequest,
  parseAiDecisionRequest
} from '../../shared/ipc/ai'
import { AzureOpenAiDecisionService } from './azure-openai-ai-service'

export function registerAiIpc(service: AzureOpenAiDecisionService): void {
  ipcMain.handle(AI_IPC_CHANNELS.decide, (_event, request: unknown) =>
    service.decide(parseAiDecisionRequest(request))
  )
  ipcMain.handle(AI_IPC_CHANNELS.planDeck, (_event, request: unknown) =>
    service.planDeck(parseAiDeckPlanRequest(request))
  )
}
