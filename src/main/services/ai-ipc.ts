import { ipcMain } from 'electron'
import { AI_IPC_CHANNELS, parseAiDecisionRequest } from '../../shared/ipc/ai'
import { AzureOpenAiDecisionService } from './azure-openai-ai-service'

export function registerAiIpc(service: AzureOpenAiDecisionService): void {
  ipcMain.handle(AI_IPC_CHANNELS.decide, (_event, request: unknown) =>
    service.decide(parseAiDecisionRequest(request))
  )
}
