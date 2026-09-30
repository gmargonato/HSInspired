import appStartImage from '@assets/images/ui/common/app-start.png'

/** HTML and CSS own the splash so it can paint before the renderer is ready. */
export class StartupSplash {
  private readonly element = document.getElementById('startup-splash')
  private readonly blockKeyboard = (event: KeyboardEvent): void => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  constructor() {
    window.addEventListener('keydown', this.blockKeyboard, { capture: true })
    window.addEventListener('keyup', this.blockKeyboard, { capture: true })
  }

  async ready(): Promise<void> {
    const image = new Image()
    image.src = appStartImage
    // A missing splash image must not prevent the application from starting.
    await image.decode().catch(() => undefined)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  async reveal(renderFirstFrame: () => void): Promise<void> {
    renderFirstFrame()
    if (this.element) {
      await this.element.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: 1000,
        easing: 'ease-in-out',
        fill: 'forwards'
      }).finished
    }
    this.dispose()
  }

  dispose(): void {
    this.element?.remove()
    window.removeEventListener('keydown', this.blockKeyboard, { capture: true })
    window.removeEventListener('keyup', this.blockKeyboard, { capture: true })
  }
}
