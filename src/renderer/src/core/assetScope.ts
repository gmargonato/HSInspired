import { Assets } from 'pixi.js'

type AssetBundle = Record<string, string>

const registeredBundles = new Set<string>()
const bundleReferences = new Map<string, number>()
const loadedBundles = new Map<string, unknown>()
const pendingLoads = new Map<string, Promise<unknown>>()
const pendingUnloads = new Map<string, Promise<void>>()

export function registerAssetBundle(bundleId: string, assets: AssetBundle): void {
  if (registeredBundles.has(bundleId)) return

  Assets.addBundle(bundleId, assets)
  registeredBundles.add(bundleId)
}

async function loadBundle(bundleId: string): Promise<unknown> {
  const pendingUnload = pendingUnloads.get(bundleId)
  if (pendingUnload) {
    await pendingUnload
  }

  if (loadedBundles.has(bundleId)) {
    return loadedBundles.get(bundleId)
  }

  let pendingLoad = pendingLoads.get(bundleId)
  if (!pendingLoad) {
    pendingLoad = Assets.loadBundle(bundleId)
    pendingLoads.set(bundleId, pendingLoad)
  }

  try {
    const loaded = await pendingLoad
    loadedBundles.set(bundleId, loaded)
    return loaded
  } finally {
    pendingLoads.delete(bundleId)
  }
}

async function unloadBundle(bundleId: string): Promise<void> {
  const pendingUnload = Assets.unloadBundle(bundleId)
  pendingUnloads.set(bundleId, pendingUnload)

  try {
    await pendingUnload
  } finally {
    pendingUnloads.delete(bundleId)
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
    return loaded as T
  }

  async releaseAll(): Promise<void> {
    const bundlesToRelease = [...this.acquiredBundles.entries()].reverse()
    this.acquiredBundles.clear()

    for (const [bundleId, acquiredCount] of bundlesToRelease) {
      const references = bundleReferences.get(bundleId) ?? 0
      const remainingReferences = references - acquiredCount

      if (remainingReferences > 0) {
        bundleReferences.set(bundleId, remainingReferences)
      } else if (references > 0) {
        bundleReferences.delete(bundleId)
        await unloadBundle(bundleId)
      }
    }
  }
}
