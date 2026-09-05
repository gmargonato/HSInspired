import type { Application } from 'pixi.js'
import type { AppServices } from './services'
import type { SceneNavigator } from './scene-navigator'
import type { SceneManager } from '../scenes/scene-manager'
import { GameScene } from '../scenes/game-scene'
import { createTavernBrawlGameRoute } from '../features/tavern-brawl/tavern-brawl-model'
import { GAME_HEIGHT, GAME_WIDTH } from './config'
import {
  CachedOutlineFilter,
  type OutlineCacheDiagnostics
} from '../rendering/effects/cached-outline-filter'
import { AnimatedOutline } from '../rendering/effects/animated-outline'
import { BakedAnimatedOutline } from '../rendering/effects/baked-animated-outline'

const BENCHMARK_SEED = 0x48535046
const SAMPLE_MS = 1_500
const FULL_HAND_SIZE = 10
const FULL_BOARD_SIZE = 7

interface FrameSample {
  readonly name: string
  readonly kind: 'steady' | 'action'
  readonly durationMs: number
  readonly frames: number
  readonly averageFps: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly maxMs: number
  readonly framesOver33Ms: number
  readonly outlineCache: OutlineCacheDiagnostics
  readonly status: 'pass' | 'fail'
}

interface HeapSample {
  readonly name: string
  readonly usedMiB: number | null
}

export interface MatchPerformanceReport {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly outlineMode: 'live' | 'baked'
  readonly rendererResolution: number
  readonly thresholds: {
    readonly steadyMinimumFps: number
    readonly steadyP95Ms: number
    readonly steadyLongFramePercent: number
    readonly actionP95Ms: number
    readonly actionLongFramePercent: number
  }
  readonly scenarios: readonly FrameSample[]
  readonly heap: readonly HeapSample[]
  readonly aiTimings: readonly Readonly<Record<string, unknown>>[]
  readonly status: 'pass' | 'fail'
}

const thresholds = {
  steadyMinimumFps: 58,
  steadyP95Ms: 25,
  steadyLongFramePercent: 2,
  actionP95Ms: 33.4,
  actionLongFramePercent: 5
} as const

type BenchmarkWindow = Window & {
  __matchPerformanceScreenshotStage?: string
  __matchPerformanceScreenshotAck?: string
}

function waitMs(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

async function requestScreenshot(stage: string): Promise<void> {
  const benchmarkWindow = window as BenchmarkWindow
  benchmarkWindow.__matchPerformanceScreenshotAck = undefined
  benchmarkWindow.__matchPerformanceScreenshotStage = stage
  const deadline = performance.now() + 5_000
  while (
    benchmarkWindow.__matchPerformanceScreenshotAck !== stage &&
    performance.now() < deadline
  ) {
    await waitMs(50)
  }
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[Math.max(0, index)] ?? 0
}

async function sampleFrames(
  app: Application,
  name: string,
  kind: FrameSample['kind'],
  operation?: () => Promise<void>,
  minimumDurationMs = SAMPLE_MS
): Promise<FrameSample> {
  const frameTimes: number[] = []
  CachedOutlineFilter.resetDiagnostics()
  let previousFrameAt = 0
  let collecting = true
  const startedAt = performance.now()

  const collect = (): void => {
    if (!collecting) return
    const now = performance.now()
    if (previousFrameAt > 0) frameTimes.push(now - previousFrameAt)
    previousFrameAt = now
  }
  app.ticker.add(collect)

  try {
    await operation?.()
    const remaining = minimumDurationMs - (performance.now() - startedAt)
    if (remaining > 0) await waitMs(remaining)
  } finally {
    collecting = false
    app.ticker.remove(collect)
  }

  const durationMs = performance.now() - startedAt
  const sorted = [...frameTimes].sort((left, right) => left - right)
  const averageFrameMs =
    frameTimes.length > 0
      ? frameTimes.reduce((total, value) => total + value, 0) / frameTimes.length
      : durationMs
  const p95Ms = percentile(sorted, 0.95)
  const maxMs = sorted.at(-1) ?? 0
  const framesOver33Ms = frameTimes.filter((value) => value > 33.4).length
  const longFramePercent =
    frameTimes.length === 0 ? 100 : (framesOver33Ms / frameTimes.length) * 100
  const passed =
    kind === 'steady'
      ? 1000 / averageFrameMs >= thresholds.steadyMinimumFps &&
        p95Ms <= thresholds.steadyP95Ms &&
        longFramePercent <= thresholds.steadyLongFramePercent
      : p95Ms <= thresholds.actionP95Ms &&
        longFramePercent <= thresholds.actionLongFramePercent

  return {
    name,
    kind,
    durationMs: Number(durationMs.toFixed(1)),
    frames: frameTimes.length,
    averageFps: Number((1000 / averageFrameMs).toFixed(1)),
    p95Ms: Number(p95Ms.toFixed(1)),
    p99Ms: Number(percentile(sorted, 0.99).toFixed(1)),
    maxMs: Number(maxMs.toFixed(1)),
    framesOver33Ms,
    outlineCache: CachedOutlineFilter.getDiagnostics(),
    status: passed ? 'pass' : 'fail'
  }
}

function usedHeapMiB(): number | null {
  const memory = (
    performance as Performance & {
      readonly memory?: { readonly usedJSHeapSize?: number }
    }
  ).memory
  return typeof memory?.usedJSHeapSize === 'number'
    ? Number((memory.usedJSHeapSize / 1024 / 1024).toFixed(1))
    : null
}

/** Runs a deterministic renderer benchmark and returns a structured report. */
export async function runMatchPerformanceBenchmark(options: {
  readonly app: Application
  readonly sceneManager: SceneManager
  readonly navigator: SceneNavigator
  readonly services: AppServices
}): Promise<MatchPerformanceReport> {
  const scenarios: FrameSample[] = []
  const heap: HeapSample[] = []
  const aiTimings: Readonly<Record<string, unknown>>[] = []
  const benchmarkLogger = {
    info: (message: string, ...details: unknown[]): void => {
      options.services.logger.info(message, ...details)
      if (message.includes('timing') || message.includes('worker search completed')) {
        aiTimings.push({
          message,
          ...(typeof details[0] === 'object' && details[0] !== null
            ? (details[0] as Readonly<Record<string, unknown>>)
            : {})
        })
      }
    },
    warn: (message: string, ...details: unknown[]): void =>
      options.services.logger.warn(message, ...details),
    error: (message: string, ...details: unknown[]): void =>
      options.services.logger.error(message, ...details)
  }
  const measure = (
    name: string,
    kind: FrameSample['kind'],
    operation?: () => Promise<void>,
    minimumDurationMs = SAMPLE_MS
  ): Promise<FrameSample> =>
    sampleFrames(options.app, name, kind, operation, minimumDurationMs)

  const openMatch = async (seed: number): Promise<GameScene> => {
    const route = createTavernBrawlGameRoute(seed)
    const scene = new GameScene(
      route,
      options.services.deckStore,
      options.services.playerStatsStore,
      options.services.arenaStore,
      benchmarkLogger,
      options.navigator
    )
    await options.sceneManager.transitionTo(scene, {
      inset: { x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT },
      mode: 'fade',
      duration: 0.05,
      afterTransition: () => scene.playOpeningReveal()
    })
    await scene.devConfirmMulligan()
    return scene
  }

  let scene!: GameScene
  scenarios.push(
    await measure(
      'opening-and-mulligan',
      'action',
      async () => {
        scene = await openMatch(BENCHMARK_SEED)
      },
      0
    )
  )
  await waitMs(300)
  heap.push({ name: 'initial-match', usedMiB: usedHeapMiB() })
  scenarios.push(await measure('idle-board', 'steady'))

  scenarios.push(
    await measure('build-full-hand', 'action', async () => {
      await scene.runDevCommand({
        type: 'game:clear-zone',
        target: 'local',
        zone: 'hand'
      })
      await scene.runDevCommand({
        type: 'game:set-mana',
        target: 'local',
        available: 10,
        maximum: 10
      })
      for (let index = 0; index < FULL_HAND_SIZE; index += 1) {
        await scene.devAddCard('basic_fireball')
      }
    })
  )
  AnimatedOutline.setDebugSuppressed(true)
  BakedAnimatedOutline.setDebugSuppressed(true)
  await waitMs(1_000)
  scenarios.push(await measure('full-hand-outlines-disabled', 'steady'))
  AnimatedOutline.setDebugSuppressed(false)
  BakedAnimatedOutline.setDebugSuppressed(false)
  await waitMs(1_000)
  const outlineMode =
    import.meta.env.VITE_MATCH_OUTLINE_MODE === 'live' ? 'live' : 'baked'
  await requestScreenshot(`full-hand-${outlineMode}`)
  scenarios.push(await measure('full-hand-outlines', 'steady'))
  scenarios.push(
    await measure('hover-drag-targeting', 'action', () =>
      scene.devExerciseHandInteraction()
    )
  )

  scenarios.push(
    await measure('build-full-boards', 'action', async () => {
      for (const target of ['local', 'remote'] as const) {
        await scene.runDevCommand({ type: 'game:clear-zone', target, zone: 'board' })
        for (let index = 0; index < FULL_BOARD_SIZE; index += 1) {
          await scene.devSummonMinion('classic_wisp', target)
        }
      }
    })
  )
  scenarios.push(await measure('full-board-and-hand', 'steady'))
  scene.setDeckTracker('local', 'cost')
  scenarios.push(await measure('full-state-with-tracker', 'steady'))
  heap.push({ name: 'full-match-state', usedMiB: usedHeapMiB() })

  for (let restart = 1; restart <= 2; restart += 1) {
    scenarios.push(
      await measure(
        `restart-${restart}`,
        'action',
        async () => {
          scene = await openMatch(BENCHMARK_SEED + restart)
        },
        0
      )
    )
    await waitMs(500)
    heap.push({ name: `after-restart-${restart}`, usedMiB: usedHeapMiB() })
  }

  scenarios.push(
    await measure('match-disposal', 'action', () =>
      options.navigator.navigate({ id: 'main-menu', entryMode: 'returning' })
    )
  )
  await waitMs(500)
  heap.push({ name: 'after-disposal', usedMiB: usedHeapMiB() })

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    outlineMode,
    rendererResolution: options.app.renderer.resolution,
    thresholds,
    scenarios,
    heap,
    aiTimings,
    status: scenarios.every((scenario) => scenario.status === 'pass') ? 'pass' : 'fail'
  }
}
