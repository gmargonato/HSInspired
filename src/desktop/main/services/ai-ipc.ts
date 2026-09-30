import { app, ipcMain } from 'electron'
import {
  AI_IPC_CHANNELS,
  aiIpcFailure,
  aiIpcSuccess,
  parseAiIdentity,
  parseAiDecisionRequest
} from '../../contracts/ipc/ai'
import type { AiDecisionServiceContract } from './ai-decision-service'

export function registerAiIpc(service: AiDecisionServiceContract): void {
  const active = new Map<
    number,
    { requestId: string; matchId: string; controller: AbortController }
  >()
  const watched = new Set<number>()
  const cancel = (owner: number, reason: string): void => {
    active.get(owner)?.controller.abort(new Error(reason))
    active.delete(owner)
  }
  app.on('before-quit', () => {
    for (const owner of active.keys()) cancel(owner, 'app-before-quit')
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
          cancel(owner, 'window-destroyed')
          watched.delete(owner)
        })
        event.sender.on('render-process-gone', () =>
          cancel(owner, 'render-process-gone')
        )
        event.sender.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => {
          if (mainFrame) cancel(owner, 'main-frame-navigation')
        })
      }
      cancel(owner, 'superseded-by-new-decide')
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
      cancel(event.sender.id, 'renderer-cancel')
  })
}
