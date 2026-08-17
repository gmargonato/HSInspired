import { Assets, Texture } from 'pixi.js'

const cardAssetUrls = import.meta.glob('../assets/images/cards/*.png', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

const cardAssetUrlsByName = Object.fromEntries(
  Object.entries(cardAssetUrls).map(([key, url]) => [
    key.slice(key.lastIndexOf('/') + 1).toLowerCase(),
    url
  ])
) as Record<string, string>

const artworkUrls = import.meta.glob('../assets/images/artwork/*.{jpg,jpeg,png}', {
  eager: true,
  import: 'default',
  query: '?url'
}) as Record<string, string>

const CARD_ARTWORK_FILES: Readonly<Record<string, string>> = {
  basic_acidic_swamp_ooze: '01.jpg',
  basic_arcane_explosion: '02.jpg',
  basic_arcanite_reaper: '03.jpg'
}

function assetUrl(fileName: string): string | undefined {
  return cardAssetUrlsByName[fileName.toLowerCase()]
}

function artworkGlobKey(fileName: string): string {
  return `../assets/images/artwork/${fileName}`
}

export function hasCardAsset(fileName: string): boolean {
  return assetUrl(fileName) !== undefined
}

export function getCardAssetUrl(fileName: string): string {
  const url = assetUrl(fileName)
  if (!url) throw new Error(`Card asset is missing: ${fileName}`)
  return url
}

export function hasCardArtwork(cardId: string): boolean {
  const fileName = CARD_ARTWORK_FILES[cardId]
  return fileName !== undefined && artworkGlobKey(fileName) in artworkUrls
}

export function getCardArtworkUrl(cardId: string): string | undefined {
  const fileName = CARD_ARTWORK_FILES[cardId]
  if (!fileName) return undefined
  return artworkUrls[artworkGlobKey(fileName)]
}

export class CardAssetResolver {
  private readonly texturePromises = new Map<string, Promise<Texture>>()
  private readonly artworkPromises = new Map<string, Promise<Texture>>()

  load(fileName: string): Promise<Texture> {
    const existing = this.texturePromises.get(fileName)
    if (existing) return existing

    const promise = Assets.load<Texture>(getCardAssetUrl(fileName))
    this.texturePromises.set(fileName, promise)
    return promise
  }

  loadArtwork(cardId: string): Promise<Texture | undefined> {
    const artworkUrl = getCardArtworkUrl(cardId)
    if (!artworkUrl) return Promise.resolve(undefined)

    const existing = this.artworkPromises.get(cardId)
    if (existing) return existing

    const promise = Assets.load<Texture>(artworkUrl)
    this.artworkPromises.set(cardId, promise)
    return promise
  }
}
