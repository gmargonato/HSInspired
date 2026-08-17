import { ipcMain } from 'electron'
import { DECK_IPC_CHANNELS, type DeckCreateRequest } from '../../shared/decks'
import { DeckRepository } from './deckRepository'

/** Registers the narrow deck persistence API exposed to the sandboxed renderer. */
export function registerDeckIpc(repository: DeckRepository): void {
  ipcMain.handle(DECK_IPC_CHANNELS.list, () => repository.list())
  ipcMain.handle(DECK_IPC_CHANNELS.create, (_event, request?: DeckCreateRequest) =>
    repository.create(request)
  )
  ipcMain.handle(DECK_IPC_CHANNELS.update, (_event, deck) => repository.update(deck))
  ipcMain.handle(DECK_IPC_CHANNELS.delete, (_event, deckId: string) =>
    repository.delete(deckId)
  )
}
