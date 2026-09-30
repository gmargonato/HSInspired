import { ipcMain } from 'electron'
import {
  DECK_IPC_CHANNELS,
  parseDeckCreateRequest,
  parseDeckId,
  parseDeckResponse,
  parseDeckListResponse
} from '../../contracts/ipc/decks'
import { DeckRepository } from './deck-repository'

/** Registers the narrow deck persistence API exposed to the sandboxed renderer. */
export function registerDeckIpc(repository: DeckRepository): void {
  ipcMain.handle(DECK_IPC_CHANNELS.list, async () =>
    parseDeckListResponse(await repository.list())
  )
  ipcMain.handle(DECK_IPC_CHANNELS.create, async (_event, request: unknown) =>
    parseDeckResponse(await repository.create(parseDeckCreateRequest(request)))
  )
  ipcMain.handle(DECK_IPC_CHANNELS.update, async (_event, deck: unknown) =>
    parseDeckResponse(await repository.update(parseDeckResponse(deck)))
  )
  ipcMain.handle(DECK_IPC_CHANNELS.delete, async (_event, deckId: unknown) => {
    await repository.delete(parseDeckId(deckId))
  })
}
