import { Scene } from '../../visual-components/lifecycle/scene'
import { OutlineLab } from './'

/** Development-only editor for persisted outline preset tuning. */
export class OutlineLabScene extends Scene {
  readonly devSceneId = 'outline-lab' as const
  private lab!: OutlineLab

  async init(): Promise<void> {
    const canvas = this.appInstance.canvas
    const parent = canvas.parentElement
    if (!parent) throw new Error('Shader Lab requires a canvas parent element')
    this.lab = new OutlineLab({
      canvas,
      renderer: this.appInstance.renderer,
      parent,
      cursor: this.sceneManager.cursor
    })
    this.root.addChild(this.lab)
    try {
      await this.lab.mount()
    } catch (error) {
      this.lab.dispose()
      throw error
    }
  }

  update(deltaMS: number): void {
    this.lab?.update(deltaMS)
  }

  protected onPause(): void {
    this.lab.setControlsVisible(false)
  }

  protected onResume(): void {
    this.lab.setControlsVisible(true)
  }

  protected onExit(): void {
    this.lab.dispose()
  }
}
