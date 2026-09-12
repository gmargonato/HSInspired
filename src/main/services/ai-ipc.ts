import { app, ipcMain } from 'electron'
import {
  AI_IPC_CHANNELS,
  aiIpcFailure,
  aiIpcSuccess,
  parseAiIdentity,
  parseAiDecisionRequest
} from '../../shared/ipc/ai'
import type { AiDecisionServiceContract } from './ai-decision-service'

export function registerAiIpc(service: AiDecisionServiceContract): void {
  const active = new Map<
    number,
    { requestId: string; matchId: string; controller: AbortController }
  >()
  const watched = new Set<number>()
  const cancel = (owner: number): void => {
    active.get(owner)?.controller.abort()
    active.delete(owner)
  }
  app.on('before-quit', () => {
    for (const owner of active.keys()) cancel(owner)
  })
  ipcMain.handle(AI_IPC_CHANNELS.settings, async () => {
    try {
      return aiIpcSuccess(await service.settings())
    } catch (error) {
      return aiIpcFailure(error)
    }
  })
  ipcMain.handle(AI_IPC_CHANNELS.decide, async (event, value: unknown) => {
    try {
      const request = parseAiDecisionRequest(value)
      const owner = event.sender.id
      if (!watched.has(owner)) {
        watched.add(owner)
        event.sender.once('destroyed', () => {
          cancel(owner)
          watched.delete(owner)
        })
        event.sender.on('render-process-gone', () => cancel(owner))
        event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
          if (mainFrame) cancel(owner)
        })
      }
      cancel(owner)
      const entry = {
        requestId: request.requestId,
        matchId: request.matchId,
        controller: new AbortController()
      }
      active.set(owner, entry)
      try {
        return aiIpcSuccess(
          await service.decide(request, entry.controller.signal, (progress) => {
            if (active.get(owner) === entry && !event.sender.isDestroyed())
              event.sender.send(AI_IPC_CHANNELS.progress, progress)
          })
        )
      } finally {
        if (active.get(owner) === entry) active.delete(owner)
      }
    } catch (error) {
      return aiIpcFailure(error)
    }
  })
  ipcMain.handle(AI_IPC_CHANNELS.cancel, (event, value: unknown) => {
    const identity = parseAiIdentity(value)
    const entry = active.get(event.sender.id)
    if (entry?.requestId === identity.requestId && entry.matchId === identity.matchId)
      cancel(event.sender.id)
  })
}
