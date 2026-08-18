import { Application, Container, Graphics, Rectangle } from 'pixi.js'
import { CARD_CATALOG } from './card-catalog'
import { CardAssetResolver } from './card-asset-manifest'
import { CardView, type CardNodeInspector } from './card-view'
import {
  visualTemplateFor,
  type CardNodeOverrides,
  type CardTemplate
} from './card-render-plan'
import './styles.css'

const LAB_WIDTH = 1280
const LAB_HEIGHT = 900
const DEFAULT_CARD_ID = 'basic_acidic_swamp_ooze'

const query = new URLSearchParams(window.location.search)
const exportMode = query.get('export') === '1'
document.body.dataset.export = String(exportMode)

const app = new Application()
const resolver = new CardAssetResolver()
const root = new Container()
let currentView: CardView | null = null
let currentRenderSequence = 0
let selectedBuilderPath: string | null = null
const CARD_OVERRIDES_STORAGE_KEY = 'card-lab:card-node-overrides'
let cardOverridesByTemplate = readStoredCardOverrides()
let builderDrag: {
  readonly path: string
  readonly startGlobalX: number
  readonly startGlobalY: number
  readonly startX: number
  readonly startY: number
} | null = null

type StoredCardOverrides = Readonly<Partial<Record<CardTemplate, CardNodeOverrides>>>

const CARD_TEMPLATES: readonly CardTemplate[] = ['minion', 'spell', 'weapon', 'hero']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStoredCardOverrides(): StoredCardOverrides {
  try {
    const stored = window.localStorage.getItem(CARD_OVERRIDES_STORAGE_KEY)
    if (!stored) return {}
    const parsed: unknown = JSON.parse(stored)
    if (!isRecord(parsed)) return {}

    const isTemplateStore = CARD_TEMPLATES.some((template) =>
      isRecord(parsed[template])
    )
    if (isTemplateStore) {
      return Object.fromEntries(
        CARD_TEMPLATES.flatMap((template) =>
          isRecord(parsed[template]) ? [[template, parsed[template]]] : []
        )
      ) as StoredCardOverrides
    }

    // Migrate the original flat store as minion-template overrides. The old
    // builder always started on a minion, so this preserves those edits without
    // leaking them into spell, weapon, or hero profiles.
    return { minion: parsed as CardNodeOverrides }
  } catch {
    return {}
  }
}

function persistStoredCardOverrides(): void {
  try {
    window.localStorage.setItem(
      CARD_OVERRIDES_STORAGE_KEY,
      JSON.stringify(cardOverridesByTemplate)
    )
  } catch {
    // Persistence is a convenience; the live builder remains usable if storage is unavailable.
  }
}

function persistBuilderOverrides(): void {
  if (!currentView) return
  const template = currentView.plan.template
  const overrides = currentView.getNodeOverrides()
  const nextOverrides = { ...cardOverridesByTemplate }
  if (Object.keys(overrides).length === 0) {
    delete nextOverrides[template]
  } else {
    nextOverrides[template] = overrides
  }
  cardOverridesByTemplate = nextOverrides
  persistStoredCardOverrides()
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Card Lab element is missing: #${id}`)
  return element as T
}

function makeStageBackground(): Graphics {
  const background = new Graphics()
  background.rect(0, 0, LAB_WIDTH, LAB_HEIGHT).fill(0x10131b)
  return background
}

function updateDiagnostics(cardId: string, view: CardView): void {
  if (exportMode) return
  const diagnostics = getElement<HTMLPreElement>('diagnostics')
  const textureLayers = view.plan.layers.filter((layer) => layer.kind === 'texture')
  const textLayers = view.plan.layers.filter((layer) => layer.kind === 'text')
  const nodeLines = view.getNodeInspectors().map((node) => {
    const dimensions =
      node.width === undefined || node.height === undefined
        ? ''
        : ` ${Math.round(node.width)}x${Math.round(node.height)}`
    const detail = node.assetName ?? node.text ?? ''
    return `node     ${node.path} @ ${Math.round(node.x)},${Math.round(node.y)}${dimensions}${detail ? `: ${detail}` : ''}`
  })
  diagnostics.textContent = [
    `${cardId}`,
    `${view.plan.template} - ${view.plan.width}x${view.plan.height} (root Y scale ${view.plan.renderScaleY})`,
    `layers: ${view.plan.layers.length} (${textureLayers.length} textures, ${textLayers.length} text)`,
    `nodes: ${view.getNodeInspectors().length} (hierarchical template)`,
    ...nodeLines,
    ...view.plan.diagnostics.map((message) => `note     ${message}`)
  ].join('\n')
}

function builderElement<T extends HTMLElement>(id: string): T {
  return getElement<T>(id)
}

function builderPathLabel(path: string): string {
  return path.replace(/^card\.?/, '') || 'card'
}

function updateBuilderFields(inspector: CardNodeInspector | null): void {
  const selected = builderElement<HTMLInputElement>('builder-selected')
  const kind = builderElement<HTMLInputElement>('builder-kind')
  const visible = builderElement<HTMLInputElement>('builder-visible')
  const typography = builderElement<HTMLDivElement>('builder-typography')
  const x = builderElement<HTMLInputElement>('builder-x')
  const y = builderElement<HTMLInputElement>('builder-y')
  const width = builderElement<HTMLInputElement>('builder-width')
  const height = builderElement<HTMLInputElement>('builder-height')
  const fontSize = builderElement<HTMLInputElement>('builder-font-size')
  const lineHeight = builderElement<HTMLInputElement>('builder-line-height')

  selected.value = inspector?.path ?? ''
  kind.value = inspector?.kind ?? ''
  visible.checked = inspector?.visible ?? false
  x.value = inspector ? String(Math.round(inspector.x * 100) / 100) : ''
  y.value = inspector ? String(Math.round(inspector.y * 100) / 100) : ''
  width.value =
    inspector?.width === undefined
      ? ''
      : String(Math.round(inspector.width * 100) / 100)
  height.value =
    inspector?.height === undefined
      ? ''
      : String(Math.round(inspector.height * 100) / 100)
  width.disabled = !inspector || inspector.width === undefined
  height.disabled = !inspector || inspector.height === undefined
  visible.disabled = !inspector
  typography.hidden = inspector?.kind !== 'text'
  fontSize.value = inspector?.fontSize === undefined ? '' : String(inspector.fontSize)
  lineHeight.value =
    inspector?.lineHeight === undefined ? '' : String(inspector.lineHeight)
}

function selectBuilderNode(path: string): void {
  selectedBuilderPath = path
  const view = currentView
  if (!view) return
  const inspector = view.getNodeInspector(path)
  const status = builderElement<HTMLParagraphElement>('builder-status')
  status.textContent = `${inspector.kind}: ${builderPathLabel(path)}. Drag the selected node on the card or edit its values below.`
  updateBuilderFields(inspector)
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '#builder-tree button'
  )) {
    button.dataset.selected = String(button.dataset.path === path)
  }
}

function populateBuilder(view: CardView): void {
  const builder = builderElement<HTMLElement>('builder')
  builder.hidden = exportMode

  const tree = builderElement<HTMLDivElement>('builder-tree')
  tree.replaceChildren()
  for (const inspector of view.getNodeInspectors()) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.path = inspector.path
    button.textContent = `${'  '.repeat(Math.max(0, inspector.path.split('.').length - 2))}${builderPathLabel(inspector.path)} (${inspector.kind})`
    button.addEventListener('click', () => selectBuilderNode(inspector.path))
    tree.appendChild(button)
  }

  const available = view.getNodeInspectors()
  const selected =
    selectedBuilderPath && available.some((node) => node.path === selectedBuilderPath)
      ? selectedBuilderPath
      : available[0]?.path
  if (selected) selectBuilderNode(selected)
}

function readBuilderNumber(id: string): number | undefined {
  const value = Number(builderElement<HTMLInputElement>(id).value)
  return Number.isFinite(value) ? value : undefined
}

function applyBuilderGeometry(field: 'x' | 'y' | 'width' | 'height'): void {
  if (!currentView || !selectedBuilderPath) return
  const value = readBuilderNumber(`builder-${field}`)
  if (value === undefined) return
  currentView.setNodeGeometry(selectedBuilderPath, { [field]: value })
  persistBuilderOverrides()
  updateBuilderFields(currentView.getNodeInspector(selectedBuilderPath))
  app.render()
}

function applyBuilderTypography(field: 'fontSize' | 'lineHeight'): void {
  if (!currentView || !selectedBuilderPath) return
  const value = readBuilderNumber(
    `builder-${field === 'fontSize' ? 'font-size' : 'line-height'}`
  )
  if (value === undefined) return
  currentView.setNodeTypography(selectedBuilderPath, { [field]: value })
  persistBuilderOverrides()
  updateBuilderFields(currentView.getNodeInspector(selectedBuilderPath))
  app.render()
}

function installBuilderControls(): void {
  for (const field of ['x', 'y', 'width', 'height'] as const) {
    builderElement<HTMLInputElement>(`builder-${field}`).addEventListener(
      'change',
      () => {
        applyBuilderGeometry(field)
      }
    )
  }
  for (const field of ['fontSize', 'lineHeight'] as const) {
    builderElement<HTMLInputElement>(
      `builder-${field === 'fontSize' ? 'font-size' : 'line-height'}`
    ).addEventListener('change', () => applyBuilderTypography(field))
  }
  builderElement<HTMLInputElement>('builder-visible').addEventListener(
    'change',
    (event) => {
      if (!currentView || !selectedBuilderPath) return
      currentView.setNodeVisible(
        selectedBuilderPath,
        (event.currentTarget as HTMLInputElement).checked
      )
      persistBuilderOverrides()
      app.render()
    }
  )
  builderElement<HTMLButtonElement>('builder-reset').addEventListener('click', () => {
    if (currentView) {
      const nextOverrides = { ...cardOverridesByTemplate }
      delete nextOverrides[currentView.plan.template]
      cardOverridesByTemplate = nextOverrides
      persistStoredCardOverrides()
    }
    void renderCard(readSelectedCardId()).catch(showError)
  })
  builderElement<HTMLButtonElement>('builder-copy').addEventListener(
    'click',
    async () => {
      if (!currentView) return
      const output = JSON.stringify(currentView.getNodeOverrides(), null, 2)
      builderElement<HTMLPreElement>('builder-output').textContent = output
      try {
        await navigator.clipboard?.writeText(output)
      } catch {
        // Clipboard permissions are optional; the visible output remains available.
      }
    }
  )
}

function handleBuilderPointerDown(
  path: string,
  event: import('pixi.js').FederatedPointerEvent
): void {
  if (exportMode || !currentView) return

  selectBuilderNode(path)
  const inspector = currentView.getNodeInspector(path)
  builderDrag = {
    path,
    startGlobalX: event.global.x,
    startGlobalY: event.global.y,
    startX: inspector.x,
    startY: inspector.y
  }
  app.canvas.setPointerCapture(event.pointerId)
}

function installBuilderDragging(): void {
  app.canvas.addEventListener('pointermove', (event) => {
    if (!builderDrag || !currentView) return
    const bounds = app.canvas.getBoundingClientRect()
    const currentGlobalX = (event.clientX - bounds.left) * (LAB_WIDTH / bounds.width)
    const currentGlobalY = (event.clientY - bounds.top) * (LAB_HEIGHT / bounds.height)
    const cardDeltaX = (currentGlobalX - builderDrag.startGlobalX) / currentView.scale.x
    const cardDeltaY =
      (currentGlobalY - builderDrag.startGlobalY) /
      (currentView.scale.y * currentView.plan.renderScaleY)
    currentView.setNodeGeometry(builderDrag.path, {
      x: builderDrag.startX + cardDeltaX,
      y: builderDrag.startY + cardDeltaY
    })
    persistBuilderOverrides()
    if (selectedBuilderPath === builderDrag.path) {
      updateBuilderFields(currentView.getNodeInspector(builderDrag.path))
    }
    app.render()
  })
  const stopDragging = (event: PointerEvent) => {
    if (builderDrag && app.canvas.hasPointerCapture(event.pointerId)) {
      app.canvas.releasePointerCapture(event.pointerId)
    }
    builderDrag = null
  }
  app.canvas.addEventListener('pointerup', stopDragging)
  app.canvas.addEventListener('pointercancel', stopDragging)
}

async function waitForFonts(): Promise<void> {
  if (!document.fonts) return
  await Promise.all([
    document.fonts.load('42px Belwe'),
    document.fonts.load('38px "Arial Narrow"'),
    document.fonts.load('400 38px "Franklin Gothic Condensed"'),
    document.fonts.load('700 38px "Franklin Gothic Condensed"')
  ])
}

function readSelectedCardId(): string {
  const idFromQuery = query.get('cardId')
  if (idFromQuery) return idFromQuery
  if (exportMode) return DEFAULT_CARD_ID
  return getElement<HTMLInputElement>('card-id').value.trim() || DEFAULT_CARD_ID
}

function updateQuery(cardId: string): void {
  if (exportMode) return
  const nextQuery = new URLSearchParams(window.location.search)
  nextQuery.set('cardId', cardId)
  window.history.replaceState(null, '', `${window.location.pathname}?${nextQuery}`)
}

async function renderCard(cardId: string): Promise<void> {
  const renderSequence = ++currentRenderSequence
  try {
    const card = CARD_CATALOG.get(cardId)
    if (!card) throw new Error(`Unknown card id: ${cardId}`)

    const debug = exportMode ? false : getElement<HTMLInputElement>('debug').checked
    const artwork = await resolver.loadArtwork(card.id)
    const view = await CardView.create(card, resolver, {
      debug,
      artwork,
      nodeOverrides: !exportMode
        ? cardOverridesByTemplate[visualTemplateFor(card.type)]
        : undefined,
      onNodeSelected: selectBuilderNode,
      onNodePointerDown: handleBuilderPointerDown
    })
    if (renderSequence !== currentRenderSequence) {
      view.destroy({ children: true })
      return
    }
    if (debug) view.addDebugOverlay()

    if (currentView) {
      root.removeChild(currentView)
      currentView.destroy({ children: true })
    }
    currentView = view
    root.addChild(view)
    populateBuilder(view)

    const displayScale = exportMode ? 1 : Math.min(0.72, 650 / view.renderedHeight)
    view.scale.set(displayScale)
    view.position.set(
      (LAB_WIDTH - view.plan.width * displayScale) / 2,
      (LAB_HEIGHT - view.renderedHeight * displayScale) / 2
    )

    updateDiagnostics(cardId, view)
    updateQuery(cardId)
    app.render()

    if (exportMode) {
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve())
      )
      const canvas = app.renderer.extract.canvas({
        target: view,
        frame: new Rectangle(0, 0, view.plan.width, view.plan.height)
      })
      if (!canvas.toDataURL)
        throw new Error('Card Lab export canvas has no PNG encoder')
      const dataUrl = canvas.toDataURL('image/png')
      window.cardLabExport = dataUrl
    }
  } catch (error) {
    if (renderSequence === currentRenderSequence) throw error
  }
}

function populateCardIds(): void {
  if (exportMode) return
  const datalist = getElement<HTMLDataListElement>('card-id-options')
  for (const card of CARD_CATALOG.all) {
    const option = document.createElement('option')
    option.value = card.id
    option.label = `${card.name} - ${card.type}`
    datalist.appendChild(option)
  }
}

async function bootstrap(): Promise<void> {
  await waitForFonts()
  await app.init({
    width: LAB_WIDTH,
    height: LAB_HEIGHT,
    backgroundAlpha: 0,
    antialias: true,
    resolution: 1,
    autoDensity: true
  })

  const stage = getElement<HTMLDivElement>('stage')
  stage.appendChild(app.canvas)
  installBuilderControls()
  installBuilderDragging()
  app.stage.addChild(makeStageBackground())
  app.stage.addChild(root)

  populateCardIds()
  if (!exportMode) {
    getElement<HTMLInputElement>('card-id').value = readSelectedCardId()
    getElement<HTMLButtonElement>('render-card').addEventListener('click', () => {
      void renderCard(readSelectedCardId()).catch(showError)
    })
  }

  await renderCard(readSelectedCardId())
  document.body.dataset.cardLabReady = 'true'
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  window.cardLabError = message
  document.body.dataset.cardLabError = message
  if (!exportMode) getElement<HTMLPreElement>('diagnostics').textContent = message
  console.error('[Card Lab]', error)
}

void bootstrap().catch(showError)
