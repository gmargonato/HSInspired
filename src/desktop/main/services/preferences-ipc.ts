import { ipcMain } from 'electron'
import {
  PREFERENCES_IPC_CHANNELS,
  parsePreferences,
  parsePreferencesUpdateRequest
} from '../../contracts/ipc/preferences'
import { PreferencesRepository } from './preferences-repository'

/** Registers the narrow preferences persistence API exposed to the sandboxed renderer. */
export function registerPreferencesIpc(repository: PreferencesRepository): void {
  ipcMain.handle(PREFERENCES_IPC_CHANNELS.get, async () =>
    parsePreferences(await repository.get())
  )
  ipcMain.handle(PREFERENCES_IPC_CHANNELS.set, async (_event, request: unknown) => {
    const update = parsePreferencesUpdateRequest(request)
    const current = await repository.get()
    const next = {
      ...current,
      ...(update.lastPlayedDeckId === undefined
        ? {}
        : { lastPlayedDeckId: update.lastPlayedDeckId }),
      ...(update.aiMode === undefined ? {} : { aiMode: update.aiMode })
    }
    await repository.set(next)
    return parsePreferences(next)
  })
}
