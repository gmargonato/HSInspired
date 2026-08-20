import type { AudioService } from '../app/audio'
import type { AppLogger } from '../app/services'
import { NewDeckView } from '../features/deck-builder/NewDeckView'
import type { DeckStore } from '../features/deck-builder/deck-store'
import { Scene } from './Scene'

/** Route adapter that mounts the feature-owned deck-builder view. */
export class NewDeckScene extends Scene {
  private readonly view: NewDeckView

  constructor(deckStore: DeckStore, audio?: AudioService, logger?: AppLogger) {
    super()
    this.view = new NewDeckView(deckStore, {}, audio, logger)
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
