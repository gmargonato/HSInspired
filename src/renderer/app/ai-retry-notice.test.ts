import { afterEach, expect, it, vi } from 'vitest'
import { BrowserDialogService } from './services'

// Minimal DOM double: exercise the real notice builder without launching Electron.
class Element {
  id = ''
  type = ''
  disabled = false
  style = {}
  children: Element[] = []
  private text = ''
  private clickHandler?: () => void
  get textContent(): string {
    return this.text
  }
  set textContent(value: string) {
    this.text = value
    this.children = []
  }
  setAttribute(): void {}
  appendChild(child: Element): void {
    this.children.push(child)
  }
  addEventListener(_event: string, callback: () => void, options?: { once?: boolean }): void {
    this.clickHandler = callback
    void options
  }
  remove = vi.fn()
  click(): void {
    if (!this.disabled) this.clickHandler?.()
  }
}
afterEach(() => vi.unstubAllGlobals())
it('offers a single-use Retry AI action and replaces old controls on a new notice', () => {
  let notice: Element | null = null
  vi.stubGlobal('document', {
    getElementById: () => notice,
    createElement: () => new Element(),
    body: {
      appendChild: (element: Element) => {
        notice = element
      }
    }
  })
  const dialogs = new BrowserDialogService()
  const retry = vi.fn()
  dialogs.error('AI paused', retry)
  const current = notice as unknown as Element
  const button = current.children.find((child) => child.textContent === 'Retry AI')!
  button.click()
  button.click()
  expect(retry).toHaveBeenCalledOnce()
  expect(current.remove).toHaveBeenCalledOnce()
  dialogs.error('Other error')
  expect(current.children.map((child) => child.textContent)).toEqual([
    'Other error',
    'Dismiss'
  ])
})
it('exits the match when the opponent-left overlay is clicked once', () => {
  let overlay: Element | null = null
  vi.stubGlobal('document', {
    getElementById: () => null,
    createElement: () => new Element(),
    body: {
      appendChild: (element: Element) => {
        overlay = element
      }
    }
  })
  const dialogs = new BrowserDialogService()
  const onContinue = vi.fn()
  dialogs.abandon('Your opponent left.', onContinue)
  const current = overlay as unknown as Element
  expect(
    current.children[0]?.children.find((child) => child.textContent === 'Your opponent left.')
  ).toBeTruthy()
  current.click()
  current.click()
  expect(onContinue).toHaveBeenCalledOnce()
  expect(current.remove).toHaveBeenCalledOnce()
})
