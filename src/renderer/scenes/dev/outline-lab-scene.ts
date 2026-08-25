import { Scene } from '../scene'
import { OutlineLab } from '../../features/dev/outline-lab'

/** Development-only visual comparison scene for outline direction studies. */
export class OutlineLabScene extends Scene {
  private lab!: OutlineLab

  async init(): Promise<void> {
    this.lab = new OutlineLab()
    this.root.addChild(this.lab)
    await this.lab.mount()
  }

  update(_deltaMS: number): void {}

  protected onExit(): void {
    this.lab.dispose()
  }
}
