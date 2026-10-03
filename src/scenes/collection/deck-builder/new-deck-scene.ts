import type { AppLogger, DialogService } from '../../../application/services'
import { NewDeckView } from './new-deck-view'
import type { DeckStore } from '../../../application/contracts/deck-store'
import { Scene } from '../../../visual-components/lifecycle/scene'

/** Route adapter for deck creation within the collection workflow. */
export class NewDeckScene extends Scene {
  private readonly view: NewDeckView

  constructor(deckStore: DeckStore, logger?: AppLogger, dialogs?: DialogService) {
    super()
    this.view = new NewDeckView(
      deckStore,
      { onError: (message) => dialogs?.error(message) },
      logger
    )
  }

  async init(): Promise<void> {
    await this.view.mount()
    this.root.addChild(this.view)
  }

  open(): Promise<void> {
    return this.view.open()
  }

  update(_deltaMS: number): void {}

  protected onExit(): void {
    void this.view.dispose()
  }
}
