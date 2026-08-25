export type StandaloneAssetSource = {
  readonly kind: 'standalone'
  readonly src: string
}

export type AtlasFrameAssetSource = {
  readonly kind: 'atlas-frame'
  readonly src: string
  readonly frame: string
}

export interface AssetDefinition {
  readonly key: string
  readonly alias: string
  readonly bundle: string
  readonly source: StandaloneAssetSource | AtlasFrameAssetSource
  readonly authoredWidth: number
  readonly authoredHeight: number
  readonly owner: string
}

export function asset(
  key: string,
  bundle: string,
  alias: string,
  source: string,
  authoredWidth: number,
  authoredHeight: number,
  owner: string
): AssetDefinition {
  return {
    key,
    alias,
    bundle,
    source: { kind: 'standalone', src: source },
    authoredWidth,
    authoredHeight,
    owner
  }
}
