const { PNG } = require('pngjs')

function readArtworkRgb(bytes) {
  const image = PNG.sync.read(bytes)
  const rgb = Buffer.alloc(image.width * image.height * 3)
  for (let source = 0, target = 0; source < image.data.length; source += 4) {
    rgb[target++] = image.data[source]
    rgb[target++] = image.data[source + 1]
    rgb[target++] = image.data[source + 2]
  }
  return { width: image.width, height: image.height, gamma: image.gamma, data: rgb }
}

function opaqueArtworkPng(bytes) {
  // Preserve hidden RGB values directly; compositing against a background loses them.
  return PNG.sync.write(readArtworkRgb(bytes), {
    colorType: 2,
    inputColorType: 2,
    inputHasAlpha: false
  })
}

module.exports = { readArtworkRgb, opaqueArtworkPng }
