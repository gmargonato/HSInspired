import type { AppLogger } from '../app/services'
import { NewDeckView } from '../features/deck-builder/new-deck-view'
import type { DeckStore } from '../ui/deck-store'
import { Scene } from './scene'

/** Route adapter that mounts the feature-owned deck-builder view. */
export class NewDeckScene extends Scene {
  private readonly view: NewDeckView

  constructor(deckStore: DeckStore, logger?: AppLogger) {
    super()
    this.view = new NewDeckView(deckStore, {}, logger, { newDeckFrames: true })
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
