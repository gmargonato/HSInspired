import { Assets, Texture } from 'pixi.js'
import { hasCardAssetDefinition, resolveCardAssetDefinition } from './card-assets'

const artworkUrls = import.meta.glob(
  '../../../../../assets/images/card-artwork/*.{jpg,jpeg,png}',
  {
    eager: true,
    import: 'default',
    query: '?url'
  }
) as Record<string, string>

const CARD_ARTWORK_EXTENSION = '.jpg'

function artworkGlobKey(fileName: string): string {
  return `../../../../../assets/images/card-artwork/${fileName}`
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
  return hasCardAssetDefinition(fileName)
}

export function getCardAssetUrl(fileName: string): string {
  return resolveCardAssetDefinition(fileName).source
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
