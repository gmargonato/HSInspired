import type { AppServices } from './services'

/** Fill existing caches without turning a recoverable menu error into a boot failure. */
export async function prepareMenuData(services: AppServices): Promise<void> {
  const loads = [
    ['decks', () => services.deckStore.load()],
    ['player statistics', () => services.playerStatsStore.load()],
    ['progression', () => services.progressionStore.load()],
    // Prime the main-process cache; later reads still see current preferences.
    ['preferences', () => services.preferences?.get()]
  ] as const
  const results = await Promise.allSettled(
    loads.map(async ([, load]) => {
      await load()
    })
  )
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      services.logger.warn(
        `Failed to preload ${loads[index][0]}; the menu can retry.`,
        result.reason
      )
    }
  }
}
