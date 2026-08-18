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

const CARD_ARTWORK_EXTENSION = '.jpg'

function assetUrl(fileName: string): string | undefined {
  return cardAssetUrlsByName[fileName.toLowerCase()]
}

function artworkGlobKey(fileName: string): string {
  return `../assets/images/artwork/${fileName}`
}

function artworkFileName(cardId: string): string {
  return `${cardId}${CARD_ARTWORK_EXTENSION}`
}

/** Improves minification when the same authored texture is used by compact cards. */
function configureCardTexture(texture: Texture): Texture {
  const source = texture.source
  source.autoGenerateMipmaps = true
  source.mipLevelCount =
    Math.floor(Math.log2(Math.max(source.pixelWidth, source.pixelHeight))) + 1
  source.style.minFilter = 'linear'
  source.style.mipmapFilter = 'linear'
  source.style.update()
  return texture
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
  return artworkGlobKey(artworkFileName(cardId)) in artworkUrls
}

export function getCardArtworkUrl(cardId: string): string | undefined {
  return artworkUrls[artworkGlobKey(artworkFileName(cardId))]
}

export class CardAssetResolver {
  private readonly texturePromises = new Map<string, Promise<Texture>>()
  private readonly artworkPromises = new Map<string, Promise<Texture>>()

  load(fileName: string): Promise<Texture> {
    const existing = this.texturePromises.get(fileName)
    if (existing) return existing

    const promise = Assets.load<Texture>(getCardAssetUrl(fileName)).then(
      configureCardTexture
    )
    this.texturePromises.set(fileName, promise)
    void promise.catch(() => {
      if (this.texturePromises.get(fileName) === promise) {
        this.texturePromises.delete(fileName)
      }
    })
    return promise
  }

  loadArtwork(cardId: string): Promise<Texture | undefined> {
    const artworkUrl = getCardArtworkUrl(cardId)
    if (!artworkUrl) return Promise.resolve(undefined)

    const existing = this.artworkPromises.get(cardId)
    if (existing) return existing

    const promise = Assets.load<Texture>(artworkUrl).then(configureCardTexture)
    this.artworkPromises.set(cardId, promise)
    void promise.catch(() => {
      if (this.artworkPromises.get(cardId) === promise) {
        this.artworkPromises.delete(cardId)
      }
    })
    return promise
  }
}
