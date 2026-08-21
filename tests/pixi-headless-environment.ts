import { DOMAdapter } from 'pixi.js'
import type { Adapter } from 'pixi.js'

const headlessAdapter = {
  createCanvas: (width?: number, height?: number) => ({
    width: width ?? 0,
    height: height ?? 0,
    getContext: () => null
  }),
  createImage: () => {
    throw new Error('createImage is not available in headless tests')
  },
  getCanvasRenderingContext2D: () => {
    throw new Error('getCanvasRenderingContext2D is not available in headless tests')
  },
  getWebGLRenderingContext: () => {
    throw new Error('getWebGLRenderingContext is not available in headless tests')
  },
  getNavigator: () => ({ userAgent: 'headless-test', gpu: null }),
  getBaseUrl: () => '',
  getFontFaceSet: () => null,
  fetch: () => Promise.reject(new Error('fetch is not available in headless tests')),
  parseXML: () => {
    throw new Error('parseXML is not available in headless tests')
  }
} as unknown as Adapter

DOMAdapter.set(headlessAdapter)
