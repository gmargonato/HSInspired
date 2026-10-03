import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserDialogService } from './services'

// Exercise the real message builder without launching Electron.
class Element {
  id = ''
  className = ''
  style: Record<string, string> = {}
  children: Element[] = []
  attributes: Record<string, string> = {}
  parent: Element | null = null
  private text = ''
  constructor(readonly tag: string) {}
  get textContent(): string {
    return this.text
  }
  set textContent(value: string) {
    this.text = value
    this.children = []
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }
  appendChild(child: Element): void {
    child.parent = this
    this.children.push(child)
  }
  remove(): void {
    if (this.parent)
      this.parent.children = this.parent.children.filter((child) => child !== this)
    this.parent = null
  }
}
let body: Element
beforeEach(() => {
  vi.useFakeTimers()
  body = new Element('body')
  vi.stubGlobal('document', {
    getElementById: (id: string) =>
      body.children.find((element) => element.id === id) ?? null,
    createElement: (tag: string) => new Element(tag),
    body
  })
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('shows only the artwork and message and removes them after exactly three seconds', () => {
  new BrowserDialogService().error('A deck cannot contain more than 30 cards.')
  const notice = body.children[0]
  expect(notice.style.backgroundImage).toContain('generic-dialog.png')
  expect(notice.attributes.role).toBe('status')
  expect(notice.children.map((child) => child.tag)).toEqual(['div'])
  expect(notice.children[0].textContent).toBe(
    'A deck cannot contain more than 30 cards.'
  )
  vi.advanceTimersByTime(2999)
  expect(body.children).toEqual([notice])
  vi.advanceTimersByTime(1)
  expect(body.children).toEqual([])
})

it('replaces a message and restarts the timer without stacking notices', () => {
  const dialogs = new BrowserDialogService()
  dialogs.error('First')
  vi.advanceTimersByTime(2000)
  dialogs.error('Second')
  expect(body.children).toHaveLength(1)
  expect(body.children[0].children.map((child) => child.textContent)).toEqual([
    'Second'
  ])
  vi.advanceTimersByTime(1000)
  expect(body.children).toHaveLength(1)
  vi.advanceTimersByTime(2000)
  expect(body.children).toHaveLength(0)
  dialogs.error('Third')
  expect(body.children).toHaveLength(1)
})

it('repeated identical messages also restart the timer', () => {
  const dialogs = new BrowserDialogService()
  dialogs.error('Only two copies allowed.')
  vi.advanceTimersByTime(2500)
  dialogs.error('Only two copies allowed.')
  vi.advanceTimersByTime(2999)
  expect(body.children).toHaveLength(1)
  vi.advanceTimersByTime(1)
  expect(body.children).toHaveLength(0)
})

it('continues an abandoned match once after three seconds without a click', () => {
  const dialogs = new BrowserDialogService()
  const continueMatch = vi.fn()
  dialogs.abandon('Your opponent left.', continueMatch)
  expect(body.children).toHaveLength(1)
  expect(body.children[0].children[0].textContent).toBe('Your opponent left.')
  vi.advanceTimersByTime(2999)
  expect(continueMatch).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(body.children).toHaveLength(0)
  expect(continueMatch).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(3000)
  expect(continueMatch).toHaveBeenCalledOnce()
})

it('does not strand match recovery when another message replaces the notice', () => {
  const dialogs = new BrowserDialogService()
  const continueMatch = vi.fn()
  dialogs.abandon('Your opponent left.', continueMatch)
  vi.advanceTimersByTime(1000)
  dialogs.error('Another message')
  vi.advanceTimersByTime(2000)
  expect(continueMatch).toHaveBeenCalledOnce()
  expect(body.children[0].children[0].textContent).toBe('Another message')
  vi.advanceTimersByTime(1000)
  expect(body.children).toHaveLength(0)
})
