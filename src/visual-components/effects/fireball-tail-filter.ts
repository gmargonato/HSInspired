import { Filter } from 'pixi.js'
import { FIREBALL_LAYOUT as L } from './fireball-layout'
import { FIRE_VFX_VERTEX_SHADER, hexColorToRgb } from './fire-vfx-shader-common'

/** Blend tail coverage, not raw alpha: the native alpha exponent hides a raw
 * crossfade. Only the tail is filtered; the head and its glow stay independent.
 */
export function createFireballTailFilter(palette: {
  flameColor: string
  coreColor: string
  edgeColor?: string
}): Filter {
  const filter = Filter.from({
    gl: {
      name: 'fireball-tail-irregularity',
      vertex: FIRE_VFX_VERTEX_SHADER,
      fragment: `#version 300 es
        precision highp float;
        in vec2 vTextureCoord; in vec2 vVfxUv; out vec4 finalColor;
        uniform sampler2D uTexture;
        uniform float uIrregularity,uLength,uRadius,uLife;
        uniform vec3 uFlameColor,uCoreColor,uEdgeColor;
        void main(){
          vec4 authored=texture(uTexture,vTextureCoord);
          float x=(vVfxUv.x-0.5)*${L.missile.plane.size.width.toFixed(8)};
          float z=(0.5-vVfxUv.y)*${L.missile.plane.size.height.toFixed(8)}+${L.missile.cameraZ.toFixed(8)};
          float behind=-z;
          float fraction=clamp(behind/max(uLength,0.001),0.0,1.0);
          float width=max(0.001,uRadius*pow(1.0-fraction,0.7));
          float across=abs(x)/width;
          float coverage=(1.0-smoothstep(0.8,1.0,across))
            *smoothstep(-uRadius,0.0,behind)
            *(1.0-smoothstep(uLength-uRadius,uLength,behind))*uLife;
          vec3 color=mix(uFlameColor,uEdgeColor,smoothstep(0.25,1.0,across));
          color=mix(color,uCoreColor,(1.0-smoothstep(0.0,0.7,across))*0.35);
          vec3 clean=color*step(0.00001,coverage);
          float alpha=mix(coverage,pow(clamp(authored.a,0.0,1.0),${L.missile.alphaExponent.toFixed(1)}),uIrregularity);
          finalColor=vec4(mix(clean,authored.rgb,uIrregularity),pow(alpha,1.0/${L.missile.alphaExponent.toFixed(1)}));
        }`
    },
    resources: {
      tail: {
        uIrregularity: { value: 0, type: 'f32' },
        uLength: { value: 0, type: 'f32' },
        uRadius: { value: 0.2, type: 'f32' },
        uLife: { value: 0, type: 'f32' },
        uFlameColor: { value: hexColorToRgb(palette.flameColor), type: 'vec3<f32>' },
        uCoreColor: { value: hexColorToRgb(palette.coreColor), type: 'vec3<f32>' },
        uEdgeColor: {
          value: hexColorToRgb(palette.edgeColor ?? palette.flameColor),
          type: 'vec3<f32>'
        }
      }
    },
    clipToViewport: false,
    padding: 0,
    antialias: 'off'
  })
  filter.blendMode = 'add'
  return filter
}
