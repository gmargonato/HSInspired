import { Application, Container } from 'pixi.js'
import { gsap } from 'gsap'

export abstract class Scene {
  readonly root: Container = new Container()

  abstract init(app: Application): Promise<void> | void
  abstract update(deltaMS: number): void

  async destroy(): Promise<void> {
    this.killSceneTweens()
    this.root.destroy({ children: true })
  }

  private killSceneTweens(): void {
    const targets: unknown[] = []
    const collect = (object: Container): void => {
      targets.push(object)
      for (const child of object.children) {
        if (child instanceof Container) {
          collect(child)
        }
      }
    }
    collect(this.root)
    gsap.killTweensOf(targets)
  }
}