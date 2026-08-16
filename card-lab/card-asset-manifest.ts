import { Assets, Texture } from 'pixi.js'

const cardAssetUrls = import.meta.glob('../assets/images/cards/*.png', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

function assetGlobKey(fileName: string): string {
  return `../assets/images/cards/${fileName}`
}

export function hasCardAsset(fileName: string): boolean {
  return assetGlobKey(fileName) in cardAssetUrls
}

export function getCardAssetUrl(fileName: string): string {
  const url = cardAssetUrls[assetGlobKey(fileName)]
  if (!url) throw new Error(`Card asset is missing: ${fileName}`)
  return url
}

export class CardAssetResolver {
  private readonly texturePromises = new Map<string, Promise<Texture>>()

  load(fileName: string): Promise<Texture> {
    const existing = this.texturePromises.get(fileName)
    if (existing) return existing

    const promise = Assets.load<Texture>(getCardAssetUrl(fileName))
    this.texturePromises.set(fileName, promise)
    return promise
  }
}
