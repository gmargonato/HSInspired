import { Assets } from 'pixi.js'

type AssetBundle = Record<string, string>
type PreparedBundle = { assets: unknown; dispose: () => void }
type BundlePreparation = (assets: unknown) => PreparedBundle

const registeredBundles = new Set<string>()
const bundleSources = new Map<string, readonly string[]>()
const bundleAliases = new Map<string, ReadonlyMap<string, string>>()
const persistentBundles = new Set<string>()
const pinnedBundles = new Set<string>()
const bundleReferences = new Map<string, number>()
const sourceReferences = new Map<string, number>()
const sourcePins = new Map<string, number>()
const loadedBundles = new Map<string, unknown>()
const pendingLoads = new Map<string, Promise<unknown>>()
const pendingUnloads = new Map<string, Promise<void>>()
const pendingSourceUnloads = new Map<string, Promise<void>>()
const bundlePreparations = new Map<string, BundlePreparation>()
const preparedDisposals = new Map<string, () => void>()

export function registerAssetBundle(
  bundleId: string,
  assets: AssetBundle,
  options: { readonly persistent?: boolean; readonly prepare?: BundlePreparation } = {}
): void {
  if (registeredBundles.has(bundleId)) return

  // Pixi's resolver aliases are global even when assets belong to separate
  // bundles. Qualify them at the resolver boundary so common bundle-local
  // names such as `background` cannot overwrite one another.
  const aliases = new Map<string, string>()
  const qualifiedAssets = Object.fromEntries(
    Object.entries(assets).map(([alias, source]) => {
      const qualifiedAlias = `${bundleId}:${alias}`
      aliases.set(qualifiedAlias, alias)
      return [qualifiedAlias, source]
    })
  )

  Assets.addBundle(bundleId, qualifiedAssets)
  registeredBundles.add(bundleId)
  bundleAliases.set(bundleId, aliases)
  bundleSources.set(bundleId, [...new Set(Object.values(assets))])
  if (options.persistent) persistentBundles.add(bundleId)
  if (options.prepare) bundlePreparations.set(bundleId, options.prepare)
}

function restoreBundleAliases(bundleId: string, loaded: unknown): unknown {
  if (typeof loaded !== 'object' || loaded === null || Array.isArray(loaded)) {
    return loaded
  }

  const aliases = bundleAliases.get(bundleId)
  if (!aliases) return loaded

  return Object.fromEntries(
    Object.entries(loaded).map(([qualifiedAlias, value]) => [
      aliases.get(qualifiedAlias) ?? qualifiedAlias,
      value
    ])
  )
}

function sourcesFor(bundleId: string): readonly string[] {
  const sources = bundleSources.get(bundleId)
  if (!sources) throw new Error(`Asset bundle ${bundleId} is not registered.`)
  return sources
}

function pinPersistentBundle(bundleId: string): void {
  if (!persistentBundles.has(bundleId) || pinnedBundles.has(bundleId)) return

  pinnedBundles.add(bundleId)
  for (const source of sourcesFor(bundleId)) {
    sourcePins.set(source, (sourcePins.get(source) ?? 0) + 1)
  }
}

function addSourceReferences(bundleId: string, count: number): void {
  for (const source of sourcesFor(bundleId)) {
    sourceReferences.set(source, (sourceReferences.get(source) ?? 0) + count)
  }
}

function removeSourceReferences(bundleId: string, count: number): void {
  for (const source of sourcesFor(bundleId)) {
    const remaining = (sourceReferences.get(source) ?? 0) - count
    if (remaining > 0) sourceReferences.set(source, remaining)
    else sourceReferences.delete(source)
  }
}

async function loadBundle(bundleId: string): Promise<unknown> {
  const unloads = [
    pendingUnloads.get(bundleId),
    ...sourcesFor(bundleId).map((source) => pendingSourceUnloads.get(source))
  ].filter((pending): pending is Promise<void> => pending !== undefined)
  if (unloads.length > 0) await Promise.all([...new Set(unloads)])

  if (loadedBundles.has(bundleId)) {
    return loadedBundles.get(bundleId)
  }

  let pendingLoad = pendingLoads.get(bundleId)
  if (!pendingLoad) {
    pendingLoad = Assets.loadBundle(bundleId).then((value) => {
      const loaded = restoreBundleAliases(bundleId, value)
      const prepared = bundlePreparations.get(bundleId)?.(loaded)
      if (prepared) preparedDisposals.set(bundleId, prepared.dispose)
      const result = prepared?.assets ?? loaded
      loadedBundles.set(bundleId, result)
      pinPersistentBundle(bundleId)
      return result
    })
    pendingLoads.set(bundleId, pendingLoad)
  }

  try {
    return await pendingLoad
  } finally {
    pendingLoads.delete(bundleId)
  }
}

async function unloadBundle(bundleId: string): Promise<void> {
  if (persistentBundles.has(bundleId)) return
  preparedDisposals.get(bundleId)?.()
  preparedDisposals.delete(bundleId)

  const unreferencedSources = sourcesFor(bundleId).filter(
    (source) =>
      !sourceReferences.has(source) &&
      !sourcePins.has(source) &&
      !pendingSourceUnloads.has(source)
  )
  const existingUnloads = sourcesFor(bundleId)
    .map((source) => pendingSourceUnloads.get(source))
    .filter((pending): pending is Promise<void> => pending !== undefined)
  const sourceUnload =
    unreferencedSources.length > 0 ? Assets.unload(unreferencedSources) : undefined
  if (sourceUnload) {
    for (const source of unreferencedSources) {
      pendingSourceUnloads.set(source, sourceUnload)
    }
  }

  const unloads = sourceUnload
    ? [...new Set([...existingUnloads, sourceUnload])]
    : [...new Set(existingUnloads)]
  const pendingUnload = Promise.all(unloads).then(() => undefined)
  pendingUnloads.set(bundleId, pendingUnload)

  try {
    await pendingUnload
  } finally {
    if (pendingUnloads.get(bundleId) === pendingUnload) {
      pendingUnloads.delete(bundleId)
    }
    if (sourceUnload) {
      for (const source of unreferencedSources) {
        if (pendingSourceUnloads.get(source) === sourceUnload) {
          pendingSourceUnloads.delete(source)
        }
      }
    }
    loadedBundles.delete(bundleId)
  }
}

/** Tracks scene ownership of globally cached Pixi asset bundles. */
export class AssetScope {
  private readonly acquiredBundles = new Map<string, number>()

  async acquire<T>(bundleId: string): Promise<T> {
    const loaded = await loadBundle(bundleId)
    bundleReferences.set(bundleId, (bundleReferences.get(bundleId) ?? 0) + 1)
    this.acquiredBundles.set(bundleId, (this.acquiredBundles.get(bundleId) ?? 0) + 1)
    addSourceReferences(bundleId, 1)
    return loaded as T
  }

  async releaseAll(): Promise<void> {
    const bundlesToRelease = [...this.acquiredBundles.entries()].reverse()
    this.acquiredBundles.clear()

    for (const [bundleId, acquiredCount] of bundlesToRelease) {
      const references = bundleReferences.get(bundleId) ?? 0
      const remainingReferences = references - acquiredCount
      removeSourceReferences(bundleId, acquiredCount)

      if (remainingReferences > 0) {
        bundleReferences.set(bundleId, remainingReferences)
      } else if (references > 0) {
        bundleReferences.delete(bundleId)
        await unloadBundle(bundleId)
      }
    }
  }
}
