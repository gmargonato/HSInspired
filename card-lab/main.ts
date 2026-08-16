import { Application, Container, Graphics } from 'pixi.js'
import { CARD_CATALOG } from './card-catalog'
import { CardAssetResolver } from './card-asset-manifest'
import { CardView } from './card-view'
import './styles.css'

const LAB_WIDTH = 1280
const LAB_HEIGHT = 900
const DEFAULT_CARD_ID = 'basic_acidic_swamp_ooze'

const query = new URLSearchParams(window.location.search)
const exportMode = query.get('export') === '1'
const premiumFromQuery = query.get('premium') === '1'
document.body.dataset.export = String(exportMode)

const app = new Application()
const resolver = new CardAssetResolver()
const root = new Container()
let currentView: CardView | null = null

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
  diagnostics.textContent = [
    `${cardId}`,
    `${view.plan.template} - ${view.plan.width}x${view.plan.height}`,
    `layers: ${view.plan.layers.length} (${textureLayers.length} textures, ${textLayers.length} text)`,
    ...view.plan.layers.map((layer) => {
      if (layer.kind === 'texture') return `texture  ${layer.id}: ${layer.assetName}`
      if (layer.kind === 'text') return `text     ${layer.id}: ${layer.text}`
      return `shape    ${layer.id}: ${layer.shape}`
    }),
    ...view.plan.diagnostics.map((message) => `note     ${message}`)
  ].join('\n')
}

async function waitForFonts(): Promise<void> {
  if (!document.fonts) return
  await Promise.all([
    document.fonts.load('32px Belwe'),
    document.fonts.load('27px "Franklin Gothic Condensed"')
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
  const card = CARD_CATALOG.get(cardId)
  if (!card) throw new Error(`Unknown card id: ${cardId}`)

  const premium = exportMode
    ? premiumFromQuery
    : getElement<HTMLInputElement>('premium').checked
  const debug = exportMode ? false : getElement<HTMLInputElement>('debug').checked
  const view = await CardView.create(card, resolver, { premium, debug })
  if (debug) view.addDebugOverlay()

  if (currentView) {
    root.removeChild(currentView)
    currentView.destroy({ children: true })
  }
  currentView = view
  root.addChild(view)

  const displayScale = exportMode ? 1 : Math.min(0.72, 650 / view.plan.height)
  view.scale.set(displayScale)
  view.position.set(
    (LAB_WIDTH - view.plan.width * displayScale) / 2,
    (LAB_HEIGHT - view.plan.height * displayScale) / 2
  )

  updateDiagnostics(cardId, view)
  updateQuery(cardId)
  app.render()

  if (exportMode) {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    const canvas = app.renderer.extract.canvas(view)
    if (!canvas.toDataURL) throw new Error('Card Lab export canvas has no PNG encoder')
    const dataUrl = canvas.toDataURL('image/png')
    window.cardLabExport = dataUrl
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
