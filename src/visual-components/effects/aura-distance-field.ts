import { Texture } from 'pixi.js'

// V5 allows 180px reach + 60px bulge + 20px wobble + 10px shimmer.
// Extend the source padding so the full control range remains unclipped.
export const DISTANCE_LIMIT = 280
export const DISTANCE_PADDING = DISTANCE_LIMIT + 2
// Every card's field is built at this width (Chenvaala's), so shader
// settings in pixels mean the same share of the card on any target.
export const REFERENCE_CARD_WIDTH = 1268
const INFINITY = 1e20

// Exact squared Euclidean distance transform for one row or column.
function transformLine(
  input: Float64Array,
  length: number,
  output: Float64Array,
  sites: Int32Array,
  boundaries: Float64Array
) {
  let last = -1

  for (let position = 0; position < length; position++) {
    if (input[position] >= INFINITY) continue

    let crossing = 0

    while (last >= 0) {
      const previous = sites[last]
      crossing =
        (input[position] +
          position * position -
          (input[previous] + previous * previous)) /
        (2 * (position - previous))
      if (crossing > boundaries[last]) break
      last--
    }

    last++
    sites[last] = position
    boundaries[last] = last === 0 ? -Infinity : crossing
    boundaries[last + 1] = Infinity
  }

  if (last < 0) {
    output.fill(INFINITY, 0, length)
    return
  }

  let nearest = 0
  for (let position = 0; position < length; position++) {
    while (boundaries[nearest + 1] < position) nearest++
    const delta = position - sites[nearest]
    output[position] = delta * delta + input[sites[nearest]]
  }
}

// Smoothed outline: first a closing (dilate, then erode) with this radius
// fills gaps narrower than about twice it; then the mask is blurred and cut
// at 50%, which rounds sharp corners and drops thin spikes before measuring.
export const SMOOTH_OUTLINE_RADIUS = 56
export const SMOOTH_OUTLINE_BLUR = 40

// Running-sum box blur along rows or columns, in place.
function boxBlurLine(
  values: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  scratch: Float32Array
) {
  const lines = horizontal ? height : width
  const length = horizontal ? width : height
  const stride = horizontal ? 1 : width
  const size = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    const start = horizontal ? line * width : line
    for (let i = 0; i < length; i++) scratch[i] = values[start + i * stride]
    let sum = 0
    for (let i = -radius; i <= radius; i++)
      sum += scratch[Math.min(Math.max(i, 0), length - 1)]
    for (let i = 0; i < length; i++) {
      values[start + i * stride] = sum / size
      sum +=
        scratch[Math.min(i + radius + 1, length - 1)] - scratch[Math.max(i - radius, 0)]
    }
  }
}

// Three box passes per axis approximate a Gaussian with sigma near this radius.
function blurMask(values: Float32Array, width: number, height: number, radius: number) {
  const scratch = new Float32Array(Math.max(width, height))
  const pass = Math.max(1, Math.round(radius))
  for (let i = 0; i < 3; i++) {
    boxBlurLine(values, width, height, pass, true, scratch)
    boxBlurLine(values, width, height, pass, false, scratch)
  }
}

// Euclidean distance (in pixels) from every pixel to the nearest pixel where
// isSite(index) is true.
function distanceTransform(
  width: number,
  height: number,
  isSite: (index: number) => boolean
) {
  const distances = new Float32Array(width * height)
  const longestSide = Math.max(width, height)
  const input = new Float64Array(longestSide)
  const output = new Float64Array(longestSide)
  const sites = new Int32Array(longestSide)
  const boundaries = new Float64Array(longestSide + 1)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      input[x] = isSite(y * width + x) ? 0 : INFINITY
    }
    transformLine(input, width, output, sites, boundaries)
    distances.set(output.subarray(0, width), y * width)
  }

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      input[y] = distances[y * width + x]
    }
    transformLine(input, height, output, sites, boundaries)
    for (let y = 0; y < height; y++) {
      distances[y * width + x] = Math.sqrt(output[y])
    }
  }

  return distances
}

/** Ported from ShaderTest/distanceField.js; blue retains alpha for outline-only compositing. */
export function createAuraDistanceField(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number
) {
  const fieldScale = REFERENCE_CARD_WIDTH / sourceWidth
  const cardWidth = REFERENCE_CARD_WIDTH
  const cardHeight = Math.round(sourceHeight * fieldScale)
  const width = cardWidth + DISTANCE_PADDING * 2
  const height = cardHeight + DISTANCE_PADDING * 2

  const sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = cardWidth
  sourceCanvas.height = cardHeight
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })!
  sourceContext.imageSmoothingQuality = 'high'
  sourceContext.drawImage(image, 0, 0, cardWidth, cardHeight)
  const alpha = sourceContext.getImageData(0, 0, cardWidth, cardHeight).data

  const mask = new Uint8Array(width * height)
  for (let y = 0; y < cardHeight; y++) {
    for (let x = 0; x < cardWidth; x++) {
      if (alpha[(y * cardWidth + x) * 4 + 3] >= 128) {
        mask[(y + DISTANCE_PADDING) * width + x + DISTANCE_PADDING] = 1
      }
    }
  }

  // Red: exact distance to the card alpha.
  const exact = distanceTransform(width, height, (index) => mask[index] === 1)
  // Green: distance to the smoothed outline (closing, then blur and cut).
  const radius = SMOOTH_OUTLINE_RADIUS
  const outsideDilated = distanceTransform(
    width,
    height,
    (index) => exact[index] > radius
  )
  const smoothMask = new Float32Array(width * height)
  for (let index = 0; index < smoothMask.length; index++) {
    smoothMask[index] = outsideDilated[index] > radius ? 1 : 0
  }
  blurMask(smoothMask, width, height, SMOOTH_OUTLINE_BLUR)
  const smooth = distanceTransform(width, height, (index) => smoothMask[index] >= 0.5)

  const distanceCanvas = document.createElement('canvas')
  distanceCanvas.width = width
  distanceCanvas.height = height
  const distanceContext = distanceCanvas.getContext('2d')!
  const pixels = distanceContext.createImageData(width, height)

  for (let index = 0; index < width * height; index++) {
    const offset = index * 4
    pixels.data[offset] = Math.round(
      (Math.min(exact[index], DISTANCE_LIMIT) / DISTANCE_LIMIT) * 255
    )
    pixels.data[offset + 1] = Math.round(
      (Math.min(smooth[index], DISTANCE_LIMIT) / DISTANCE_LIMIT) * 255
    )
    const x = (index % width) - DISTANCE_PADDING
    const y = Math.floor(index / width) - DISTANCE_PADDING
    pixels.data[offset + 2] =
      x >= 0 && y >= 0 && x < cardWidth && y < cardHeight
        ? alpha[(y * cardWidth + x) * 4 + 3]
        : 0
    pixels.data[offset + 3] = 255
  }

  distanceContext.putImageData(pixels, 0, 0)
  const texture = Texture.from(distanceCanvas)
  texture.source.scaleMode = 'linear'

  return { texture, cardWidth, cardHeight, fieldScale }
}
