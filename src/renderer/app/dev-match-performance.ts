import {
  UPDATE_PRIORITY,
  type Application,
  type Container,
  type Texture
} from 'pixi.js'
import type { AiDecisionApi } from '../../shared/ipc/ai'
import type { AppServices } from './services'
import type { SceneNavigator } from './scene-navigator'
import type { SceneManager } from '../scenes/scene-manager'
import { GameScene } from '../scenes/game-scene'
import { createTavernBrawlGameRoute } from '../features/tavern-brawl/tavern-brawl-model'
import { GAME_HEIGHT, GAME_WIDTH } from './config'
import { CachedOutlineFilter } from '../rendering/effects/cached-ghost-aura-filter'
import { getPremiumMode, setPremiumMode } from '../rendering/premium-appearance'

const BENCHMARK_SEED = 0x48535046
const MIXED_HAND = [
  'basic_chillwind_yeti',
  'basic_fireball',
  'classic_wisp',
  'basic_fiery_war_axe'
] as const
const thresholds = {
  frameP95Ms: 18.5,
  frameP99Ms: 25,
  longFrameMs: 33.4,
  longFramePercent: 0.1,
  cpuP95Ms: 8,
  inputReceiptToSubmissionP95Ms: 20,
  inputReceiptToSubmissionP99Ms: 33.4
} as const

interface Point {
  readonly x: number
  readonly y: number
}
interface Distribution {
  readonly count: number
  readonly mean: number | null
  readonly p95: number | null
  readonly p99: number | null
  readonly max: number | null
}
interface InputStage {
  readonly scenario?: string
  readonly id: number
  readonly kind: 'input'
  readonly gesture: 'hover' | 'drag' | 'target' | 'pickup' | 'cycles'
  readonly start: Point
  readonly path: readonly Point[]
  readonly durationMs: number
  readonly cycles: number
  readonly settleMs: number
}
interface ScreenshotStage {
  readonly scenario?: string
  readonly id: number
  readonly kind: 'screenshot'
  readonly name: string
}
type BenchmarkWindow = Window & {
  __matchPerformanceStage?: InputStage | ScreenshotStage
  __matchPerformanceAck?: { id: number; error?: string }
  __matchPerformanceProgress?: { name: string; frames: number; startedAt: number }
}
type SampleKind = 'steady' | 'interaction' | 'action' | 'lifecycle' | 'diagnostic'
interface ResourceCounts {
  generated: number
  destroyed: number
  live: number
  peakLive: number
  offscreenSubmissions: number
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}
async function bounded<T>(
  operation: Promise<T>,
  name: string,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${name} exceeded ${timeoutMs / 1000}s; check window/GPU scheduling before interpreting performance.`
              )
            ),
          timeoutMs
        )
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}
function round(value: number): number {
  return Number(value.toFixed(3))
}
function distribution(values: readonly number[]): Distribution {
  if (!values.length) return { count: 0, mean: null, p95: null, p99: null, max: null }
  const sorted = [...values].sort((left, right) => left - right)
  const percentile = (fraction: number): number =>
    round(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]!)
  return {
    count: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: round(sorted.at(-1)!)
  }
}
function usedHeapMiB(): number | null {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } })
    .memory
  return memory ? round(memory.usedJSHeapSize / 1024 / 1024) : null
}

/** Measures screen submissions, excluding nested card/outline render-texture passes. */
async function sampleFrames(
  app: Application,
  scene: () => GameScene | undefined,
  name: string,
  kind: SampleKind,
  operation: () => Promise<void>,
  expectedGesture?: InputStage['gesture'],
  readResources?: () => ResourceCounts
) {
  const resourcesBefore = readResources?.()
  const intervals: number[] = [],
    cpu: number[] = [],
    renderCpu: number[] = []
  const pointerCpu: number[] = [],
    inputLatency: number[] = [],
    arrivalIntervals: number[] = [],
    dragErrors: number[] = []
  let frameStartedAt = 0,
    renderStartedAt = 0,
    previousSubmittedAt = 0,
    receivedAt = 0,
    previousMoveAt = 0
  let pointerSequence = 0,
    submittedPointerSequence = 0,
    inputEvents = 0,
    movementEvents = 0
  let draggedFrames = 0,
    targetingFrames = 0,
    dragStarts = 0,
    dragStartedAt = 0
  let wasDragging = false
  const eventStarts = new WeakMap<Event, number>()
  const startedAt = performance.now()
  CachedOutlineFilter.resetDiagnostics()
  const input = (event: PointerEvent): void => {
    const now = performance.now()
    eventStarts.set(event, now)
    receivedAt = now
    pointerSequence += 1
    inputEvents += 1
    if (event.type === 'pointermove') {
      movementEvents += 1
      if (previousMoveAt) arrivalIntervals.push(now - previousMoveAt)
      previousMoveAt = now
    }
  }
  const afterInput = (event: PointerEvent): void => {
    const start = eventStarts.get(event)
    if (start !== undefined) pointerCpu.push(performance.now() - start)
  }
  const startFrame = (): void => {
    frameStartedAt = performance.now()
  }
  const renderObserver = {
    prerender(options: { container: Container }): void {
      if (options.container === app.stage) renderStartedAt = performance.now()
    },
    postrender(options: { container: Container }): void {
      if (options.container !== app.stage) return
      const now = performance.now()
      const progress = (window as BenchmarkWindow).__matchPerformanceProgress
      if (progress) progress.frames += 1
      if (previousSubmittedAt) intervals.push(now - previousSubmittedAt)
      previousSubmittedAt = now
      if (frameStartedAt) cpu.push(now - frameStartedAt)
      if (renderStartedAt) renderCpu.push(now - renderStartedAt)
      if (pointerSequence !== submittedPointerSequence) {
        inputLatency.push(now - receivedAt)
        submittedPointerSequence = pointerSequence
      }
      const snapshot = scene()?.devGetHandInteractionSnapshot()
      if (!snapshot) return
      if (snapshot.dragging) {
        draggedFrames += 1
        if (!wasDragging) {
          dragStarts += 1
          dragStartedAt = now
        }
        if (snapshot.dragged && now - dragStartedAt > 150)
          dragErrors.push(
            Math.hypot(
              snapshot.dragged.x - snapshot.dragged.targetX,
              snapshot.dragged.y - snapshot.dragged.targetY
            )
          )
      }
      if (snapshot.targeting) targetingFrames += 1
      wasDragging = snapshot.dragging
    }
  }
  const eventTypes = ['pointermove', 'pointerdown', 'pointerup'] as const
  for (const type of eventTypes) {
    window.addEventListener(type, input, true)
    window.addEventListener(type, afterInput)
  }
  app.ticker.add(startFrame, undefined, UPDATE_PRIORITY.HIGH + 100)
  app.renderer.runners.prerender.add(renderObserver)
  app.renderer.runners.postrender.add(renderObserver)
  try {
    await operation()
  } finally {
    app.ticker.remove(startFrame)
    app.renderer.runners.prerender.remove(renderObserver)
    app.renderer.runners.postrender.remove(renderObserver)
    for (const type of eventTypes) {
      window.removeEventListener(type, input, true)
      window.removeEventListener(type, afterInput)
    }
  }
  const frameDistribution = distribution(intervals),
    cpuDistribution = distribution(cpu),
    latencyDistribution = distribution(inputLatency)
  const framesOver33Ms = intervals.filter(
    (value) => value > thresholds.longFrameMs
  ).length
  const longFramePercent = intervals.length
    ? (framesOver33Ms / intervals.length) * 100
    : 100
  const failures: string[] = []
  const finiteMeasurements = [
    intervals,
    cpu,
    renderCpu,
    pointerCpu,
    inputLatency,
    arrivalIntervals,
    dragErrors
  ].every((values) => values.every(Number.isFinite))
  let validInput = intervals.length > 0 && finiteMeasurements
  if (!finiteMeasurements) failures.push('A measurement contained a non-finite value.')
  if (!intervals.length) failures.push('No screen frames were submitted.')
  if (kind === 'steady' || kind === 'interaction') {
    if ((frameDistribution.p95 ?? Infinity) > thresholds.frameP95Ms)
      failures.push('Frame p95 exceeds budget.')
    if ((frameDistribution.p99 ?? Infinity) > thresholds.frameP99Ms)
      failures.push('Frame p99 exceeds budget.')
    if (longFramePercent > thresholds.longFramePercent)
      failures.push('Long-frame percentage exceeds budget.')
    if ((cpuDistribution.p95 ?? Infinity) > thresholds.cpuP95Ms)
      failures.push('CPU p95 exceeds headroom target.')
  }
  if (expectedGesture) {
    validInput =
      validInput &&
      movementEvents > 0 &&
      latencyDistribution.count > 0 &&
      (expectedGesture === 'hover' ||
        expectedGesture === 'target' ||
        draggedFrames > 0) &&
      (expectedGesture !== 'target' || targetingFrames > 0)
    if (!movementEvents || !latencyDistribution.count)
      failures.push('Browser pointer input was not observed.')
    if (expectedGesture !== 'hover' && expectedGesture !== 'target' && !draggedFrames)
      failures.push('Pointer input never picked up a held card.')
    if (expectedGesture === 'target' && !targetingFrames)
      failures.push('Targeted spell never entered targeting.')
    if (kind === 'interaction') {
      if (
        (latencyDistribution.p95 ?? Infinity) > thresholds.inputReceiptToSubmissionP95Ms
      )
        failures.push('Input receipt to submission p95 exceeds budget.')
      if (
        (latencyDistribution.p99 ?? Infinity) > thresholds.inputReceiptToSubmissionP99Ms
      )
        failures.push('Input receipt to submission p99 exceeds budget.')
    }
  }
  return {
    name,
    kind,
    validInput,
    tickerMaxFPS: app.ticker.maxFPS,
    durationMs: round(performance.now() - startedAt),
    frames: intervals.length,
    averageFps: round(1000 / (frameDistribution.mean ?? Infinity)),
    p95Ms: frameDistribution.p95 ?? 0,
    p99Ms: frameDistribution.p99 ?? 0,
    maxMs: frameDistribution.max ?? 0,
    framesOver33Ms,
    longFramePercent: round(longFramePercent),
    cpuUpdateAndSubmissionMs: cpuDistribution,
    cpuRenderSubmissionMs: distribution(renderCpu),
    pointerDispatchCpuMs: distribution(pointerCpu),
    inputReceiptToSubmissionMs: latencyDistribution,
    pointerArrivalIntervalMs: distribution(arrivalIntervals),
    dragFollowingErrorPx: distribution(dragErrors),
    inputEvents,
    movementEvents,
    draggedFrames,
    targetingFrames,
    dragStarts,
    ghostOutlineCache: CachedOutlineFilter.getDiagnostics(),
    resources: { before: resourcesBefore, after: readResources?.() },
    failures,
    status: failures.length ? ('fail' as const) : ('pass' as const)
  }
}

export type MatchPerformanceReport = Awaited<
  ReturnType<typeof runMatchPerformanceBenchmark>
>

/** Real browser input is supplied by the isolated runner, never private gesture methods. */
export async function runMatchPerformanceBenchmark(options: {
  readonly app: Application
  readonly sceneManager: SceneManager
  readonly navigator: SceneNavigator
  readonly services: AppServices
}) {
  const app = options.app,
    benchmarkWindow = window as BenchmarkWindow
  const sampleMs = Number(import.meta.env.VITE_MATCH_PERF_SAMPLE_MS || 10_000)
  const repetitions = Number(import.meta.env.VITE_MATCH_PERF_REPETITIONS || 3)
  const cycleCount = Number(import.meta.env.VITE_MATCH_PERF_CYCLES || 100)
  const handSizes = String(import.meta.env.VITE_MATCH_PERF_HAND_SIZES || '1,4,7,10')
    .split(',')
    .map(Number)
  const outlineMode = 'live' as const
  const scenarios: Awaited<ReturnType<typeof sampleFrames>>[] = []
  const heap: { name: string; usedMiB: number | null }[] = []
  let scene: GameScene | undefined,
    stageId = 0,
    fixtureError: Error | undefined
  let currentScenario = 'setup'
  let fullBoardFixture = false
  const previousPremiumMode = getPremiumMode()
  const resources: ResourceCounts = {
    generated: 0,
    destroyed: 0,
    live: 0,
    peakLive: 0,
    offscreenSubmissions: 0
  }
  const trackedTextures = new Map<Texture, () => void>()
  const generateTexture = app.renderer.generateTexture
  app.renderer.generateTexture = (settings) => {
    const texture = generateTexture.call(app.renderer, settings)
    resources.generated += 1
    resources.live += 1
    resources.peakLive = Math.max(resources.peakLive, resources.live)
    const destroyed = (): void => {
      resources.destroyed += 1
      resources.live -= 1
      trackedTextures.delete(texture)
    }
    trackedTextures.set(texture, destroyed)
    texture.once('destroy', destroyed)
    return texture
  }
  const resourceObserver = {
    postrender(settings: { container: Container }): void {
      if (settings.container !== app.stage) resources.offscreenSubmissions += 1
    }
  }
  app.renderer.runners.postrender.add(resourceObserver)
  const ai: AiDecisionApi = {
    settings: async () => ({
      enabled: true,
      provider: 'none',
      modelId: 'benchmark-fixture',
      reasoningEffort: 'none',
      maxCompletionTokens: 1
    }),
    decide: async (request) => {
      if (request.phase !== 'mulligan') {
        fixtureError = new Error('Benchmark unexpectedly requested an AI turn.')
        throw new Error('renderer-cancel: benchmark fixture only supports mulligan')
      }
      return {
        matchId: request.matchId,
        requestId: request.requestId,
        expectedRevision: request.expectedRevision,
        reason: 'Keep the deterministic opening hand.',
        choice: { replace: [], planUpdate: null },
        modelId: 'benchmark-fixture',
        durationMs: 0,
        finishReason: 'stop'
      }
    },
    cancel: async () => undefined
  }
  const requestStage = async (stage: InputStage | ScreenshotStage): Promise<void> => {
    benchmarkWindow.__matchPerformanceAck = undefined
    benchmarkWindow.__matchPerformanceStage = { ...stage, scenario: currentScenario }
    const timeout =
      stage.kind === 'input'
        ? stage.cycles * (stage.durationMs + stage.settleMs + 2_000) + 15_000
        : 15_000
    const deadline = performance.now() + timeout
    const readAck = (): BenchmarkWindow['__matchPerformanceAck'] =>
      benchmarkWindow.__matchPerformanceAck
    while (readAck()?.id !== stage.id) {
      if (fixtureError) throw fixtureError
      if (performance.now() > deadline)
        throw new Error(`Benchmark stage ${stage.id} timed out.`)
      await waitMs(20)
    }
    const error = readAck()?.error
    benchmarkWindow.__matchPerformanceStage = undefined
    if (error) throw new Error(error)
  }
  const measure = async (
    name: string,
    kind: SampleKind,
    operation: () => Promise<void>,
    gesture?: InputStage['gesture']
  ): Promise<void> => {
    currentScenario = name
    benchmarkWindow.__matchPerformanceProgress = {
      name,
      frames: 0,
      startedAt: performance.now()
    }
    scenarios.push(
      await sampleFrames(
        app,
        () => scene,
        name,
        kind,
        () =>
          bounded(
            operation(),
            name,
            kind === 'lifecycle'
              ? cycleCount * 2_500 + 30_000
              : Math.max(45_000, sampleMs + 15_000)
          ),
        gesture,
        () => ({ ...resources })
      )
    )
    if (fixtureError) throw fixtureError
  }
  const uncappedDiagnostic = async (name: string): Promise<void> => {
    const original = app.ticker.maxFPS
    try {
      app.ticker.maxFPS = 0
      await measure(name, 'diagnostic', () => waitMs(Math.min(sampleMs, 3_000)))
    } finally {
      app.ticker.maxFPS = original
    }
  }
  const openMatch = async (seed: number): Promise<GameScene> => {
    // The old scene can be disposed while a transition is still rendering.
    scene = undefined
    const baseRoute = createTavernBrawlGameRoute(seed)
    const local = baseRoute.setup.participants.find(
      (participant) => participant.controllerKind === 'human'
    )!
    const next = new GameScene(
      {
        ...baseRoute,
        setup: { ...baseRoute.setup, startingParticipantId: local.participantId }
      },
      options.services.deckStore,
      options.services.playerStatsStore,
      options.services.arenaStore,
      options.services.logger,
      options.navigator,
      ai,
      options.services.matchLogs,
      (message) => {
        fixtureError = new Error(message)
      },
      options.services.progressionStore,
      options.services.dialogs,
      options.services.preferences
    )
    await options.sceneManager.transitionTo(next, {
      inset: { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT },
      mode: 'fade',
      duration: 0.05,
      afterTransition: () => next.playOpeningReveal()
    })
    await next.devConfirmMulligan()
    await next.devWaitForPresentationIdle()
    return next
  }
  const fillHand = async (count: number): Promise<void> => {
    await scene!.runDevCommand({
      type: 'game:clear-zone',
      target: 'local',
      zone: 'hand'
    })
    await scene!.runDevCommand({
      type: 'game:set-mana',
      target: 'local',
      available: 10,
      maximum: 10
    })
    for (let index = 0; index < count; index += 1)
      await scene!.devAddCard(MIXED_HAND[index % MIXED_HAND.length]!)
    await scene!.devWaitForPresentationIdle()
    const snapshot = scene!.devGetHandInteractionSnapshot()
    if (!snapshot.ready || !snapshot.localTurn || snapshot.hand.length !== count)
      throw new Error(
        `Benchmark fixture did not produce an interactive ${count}-card hand.`
      )
  }
  const input = async (
    gesture: InputStage['gesture'],
    durationMs: number,
    cycles = 1
  ): Promise<void> => {
    const snapshot = scene!.devGetHandInteractionSnapshot()
    const card =
      gesture === 'target'
        ? snapshot.hand.find((entry) => entry.cardId === 'basic_fireball')
        : fullBoardFixture && gesture !== 'hover'
          ? snapshot.hand.find((entry) => entry.cardId === 'basic_fiery_war_axe')
          : snapshot.hand[0]
    if (!card || !snapshot.ready || !snapshot.localTurn)
      throw new Error('Benchmark input requires a ready local hand.')
    const bounds = app.canvas.getBoundingClientRect()
    const css = (point: Point): Point => ({
      x: bounds.left + (point.x * bounds.width) / app.screen.width,
      y: bounds.top + (point.y * bounds.height) / app.screen.height
    })
    const board = snapshot.boardPoint,
      target = snapshot.remoteHeroPoint
    const path =
      gesture === 'hover'
        ? snapshot.hand.map(css)
        : gesture === 'target'
          ? [css(board), css(target)]
          : [
              css({ x: board.x - app.screen.width * 0.18, y: board.y }),
              css({
                x: board.x + app.screen.width * 0.18,
                y: board.y - app.screen.height * 0.08
              }),
              css({
                x: board.x - app.screen.width * 0.12,
                y: board.y - app.screen.height * 0.12
              }),
              css(board)
            ]
    if (
      ![css(card), ...path].every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
      )
    )
      throw new Error('Benchmark input coordinates are not finite.')
    await requestStage({
      id: ++stageId,
      kind: 'input',
      gesture,
      start: css(card),
      path,
      durationMs,
      cycles,
      settleMs: 350
    })
    await scene!.devWaitForPresentationIdle()
    const after = scene!.devGetHandInteractionSnapshot()
    if (after.dragging || after.targeting || after.hand.length !== snapshot.hand.length)
      throw new Error(
        `The ${gesture} gesture did not return the card to its hand: ${JSON.stringify({ dragging: after.dragging, targeting: after.targeting, handBefore: snapshot.hand.length, handAfter: after.hand.length })}`
      )
  }
  try {
    await measure('opening-and-mulligan', 'action', async () => {
      scene = await openMatch(BENCHMARK_SEED)
    })
    heap.push({ name: 'initial-match', usedMiB: usedHeapMiB() })
    await measure('idle-board', 'steady', () => waitMs(sampleMs))
    await uncappedDiagnostic('idle-board-uncapped-diagnostic')
    for (const premium of [false, true]) {
      setPremiumMode(premium ? 'all' : 'unlocked')
      for (const handSize of handSizes) {
        await fillHand(handSize)
        const label = `${premium ? 'premium' : 'normal'}-hand-${handSize}`
        await measure(
          `${label}-cold-pickup`,
          'action',
          () => input('pickup', 250),
          'pickup'
        )
        await measure(
          `${label}-warm-pickup`,
          'action',
          () => input('pickup', 250),
          'pickup'
        )
        await waitMs(Math.min(2_000, sampleMs))
        for (let repetition = 1; repetition <= repetitions; repetition += 1) {
          await measure(
            `${label}-hover-${repetition}`,
            'interaction',
            () => input('hover', sampleMs),
            'hover'
          )
          await measure(
            `${label}-drag-${repetition}`,
            'interaction',
            () => input('drag', sampleMs),
            'drag'
          )
        }
        if (handSize > 1)
          await measure(
            `${label}-target-cancel`,
            'action',
            () => input('target', 700),
            'target'
          )
      }
    }
    await fillHand(10)
    await measure('full-premium-hand-capped-diagnostic', 'diagnostic', () =>
      waitMs(Math.min(sampleMs, 3_000))
    )
    await uncappedDiagnostic('full-premium-hand-uncapped-diagnostic')
    for (const target of ['local', 'remote'] as const) {
      await scene!.runDevCommand({ type: 'game:clear-zone', target, zone: 'board' })
      for (let index = 0; index < 7; index += 1)
        await scene!.devSummonMinion('classic_wisp', target)
    }
    scene!.setDeckTracker('local', 'cost')
    fullBoardFixture = true
    await scene!.devWaitForPresentationIdle()
    await requestStage({
      id: ++stageId,
      kind: 'screenshot',
      name: `full-state-${outlineMode}`
    })
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      await measure(
        `full-board-premium-tracker-hover-${repetition}`,
        'interaction',
        () => input('hover', sampleMs),
        'hover'
      )
      await measure(
        `full-board-premium-tracker-drag-${repetition}`,
        'interaction',
        () => input('drag', sampleMs),
        'drag'
      )
    }
    heap.push({ name: 'before-pickup-cycles', usedMiB: usedHeapMiB() })
    const texturesBeforeCycles = resources.live
    await measure(
      `pickup-return-${cycleCount}-cycles`,
      'lifecycle',
      () => input('cycles', 120, cycleCount),
      'cycles'
    )
    heap.push({ name: 'after-pickup-cycles', usedMiB: usedHeapMiB() })
    const texturesAfterCycles = resources.live
    const lifecycle = scenarios.at(-1)!
    if (lifecycle.dragStarts !== cycleCount) {
      lifecycle.failures.push(
        `Expected ${cycleCount} pickups; observed ${lifecycle.dragStarts}.`
      )
      lifecycle.status = 'fail'
      lifecycle.validInput = false
    }
    if (texturesAfterCycles > texturesBeforeCycles) {
      lifecycle.failures.push(
        'Generated textures remained live after repeated returns.'
      )
      lifecycle.status = 'fail'
      lifecycle.validInput = false
    }
    for (let restart = 1; restart <= 2; restart += 1) {
      await measure(`restart-${restart}`, 'action', async () => {
        scene = await openMatch(BENCHMARK_SEED + restart)
      })
      heap.push({ name: `after-restart-${restart}`, usedMiB: usedHeapMiB() })
    }
    await measure('match-disposal', 'action', async () => {
      scene = undefined
      await options.navigator.navigate({ id: 'main-menu', entryMode: 'returning' })
    })
    await waitMs(500)
    heap.push({ name: 'after-disposal', usedMiB: usedHeapMiB() })
    return {
      schemaVersion: 2 as const,
      generatedAt: new Date().toISOString(),
      outlineMode,
      rendererResolution: app.renderer.resolution,
      environment: {
        viewport: { width: app.screen.width, height: app.screen.height },
        devicePixelRatio: window.devicePixelRatio,
        renderer: app.renderer.name,
        tickerMaxFPS: app.ticker.maxFPS,
        userAgent: navigator.userAgent
      },
      configuration: { sampleMs, repetitions, cycleCount, handSizes, inputHz: 120 },
      measurementNotes: [
        'Frame intervals measure main-surface submissions, not physical display presentation.',
        'Input latency starts at browser pointer-event receipt and ends at the next submission; it is not input-to-photon latency.',
        'CPU spans the application ticker through submission, excluding GPU completion and work between ticks, including independently scheduled baseline GSAP updates.',
        'Pointer CPU covers capture-to-bubble dispatch when propagation reaches the window.',
        'Postrender telemetry/counter collection is excluded from the CPU span but contributes to frame cadence.',
        'Cold pickup means first pickup in a newly built hand; the measured action includes 50 ms of preparatory hover and does not guarantee an uncached GPU/program.',
        'Following error excludes the first 150 ms of pickup. Heap samples are unforced snapshots, not a leak proof.',
        'Texture counters cover renderer.generateTexture only; offscreen submissions include other card/effect work and are not held-card-only counts.',
        'Opening, cold/warm pickup, targeting, and lifecycle timings are separate from steady interaction gates.'
      ],
      thresholds,
      scenarios,
      heap,
      resources: { ...resources },
      status: scenarios.every((sample) => sample.status === 'pass')
        ? ('pass' as const)
        : ('fail' as const)
    }
  } finally {
    setPremiumMode(previousPremiumMode)
    app.renderer.generateTexture = generateTexture
    app.renderer.runners.postrender.remove(resourceObserver)
    for (const [texture, listener] of trackedTextures) texture.off('destroy', listener)
    trackedTextures.clear()
    benchmarkWindow.__matchPerformanceStage = undefined
    benchmarkWindow.__matchPerformanceAck = undefined
    benchmarkWindow.__matchPerformanceProgress = undefined
  }
}
