import { Assets, Texture } from 'pixi.js'
import { hasCardAssetDefinition, resolveCardAssetDefinition } from './card-assets'
import { resolveGadgetzanArtworkId } from './gadgetzan-artwork-aliases'

const artworkUrls = import.meta.glob(
  '../../../../assets/images/card-artwork/*.{jpg,jpeg,png}',
  {
    eager: true,
    import: 'default',
    query: '?url'
  }
) as Record<string, string>

function artworkGlobKey(fileName: string): string {
  return `../../../../assets/images/card-artwork/${fileName}`
}

function artworkFileNames(cardId: string): readonly string[] {
  const resolvedId = resolveGadgetzanArtworkId(cardId)
  return [`${resolvedId}.jpg`, `${resolvedId}.jpeg`, `${resolvedId}.png`]
}

function artworkUrl(cardId: string): string | undefined {
  return artworkFileNames(cardId)
    .map((fileName) => artworkUrls[artworkGlobKey(fileName)])
    .find((url): url is string => url !== undefined)
}

/** Improves minification when the same authored texture is used by compact cards. */
function configureCardTexture(texture: Texture): Texture {
  const source = texture.source
  const mipLevelCount =
    Math.floor(Math.log2(Math.max(source.pixelWidth, source.pixelHeight))) + 1
  const needsReconfiguration =
    !source.autoGenerateMipmaps ||
    source.mipLevelCount !== mipLevelCount ||
    source.style.minFilter !== 'linear' ||
    source.style.mipmapFilter !== 'linear'

  if (!needsReconfiguration) return texture

  source.autoGenerateMipmaps = true
  source.mipLevelCount = mipLevelCount
  source.style.minFilter = 'linear'
  source.style.mipmapFilter = 'linear'
  source.style.update()

  // Assets are cached by URL, so a card texture can share its TextureSource
  // with another bundle that rendered it before this resolver configured
  // mipmaps (the Armor badge is one example). Recreate any existing GPU
  // allocation so its mip levels agree with the updated source metadata.
  // The image resource stays loaded and is uploaded again on the next render.
  source.unload()
  return texture
}

export function hasCardAsset(fileName: string): boolean {
  return hasCardAssetDefinition(fileName)
}

export function getCardAssetUrl(fileName: string): string {
  return resolveCardAssetDefinition(fileName).source
}

export function hasCardArtwork(cardId: string): boolean {
  return artworkUrl(cardId) !== undefined
}

export function getCardArtworkUrl(cardId: string): string | undefined {
  return artworkUrl(cardId)
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

    const existing = this.artworkPromises.get(artworkUrl)
    if (existing) return existing

    const promise = Assets.load<Texture>(artworkUrl).then(configureCardTexture)
    this.artworkPromises.set(artworkUrl, promise)
    void promise.catch(() => {
      if (this.artworkPromises.get(artworkUrl) === promise) {
        this.artworkPromises.delete(artworkUrl)
      }
    })
    return promise
  }
}
