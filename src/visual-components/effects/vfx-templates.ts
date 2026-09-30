import rawLibrary from '../../../config/vfx-templates.json'
import {
  parseVfxTemplateLibrary,
  type VfxTemplate,
  type VfxTemplateLibrary
} from '../../desktop/contracts/ipc/vfx-templates'

export type {
  VfxTemplate,
  VfxTemplateLibrary
} from '../../desktop/contracts/ipc/vfx-templates'

let currentLibrary = parseVfxTemplateLibrary(rawLibrary)

export function getVfxTemplate(id: string): VfxTemplate | undefined {
  const template = currentLibrary.templates.find((item) => item.id === id)
  return template ? structuredClone(template) : undefined
}

export function getVfxTemplateLibrary(): VfxTemplateLibrary {
  return structuredClone(currentLibrary)
}

/** Keep this session in sync after the development editor saves successfully. */
export function updateVfxTemplateLibrary(library: VfxTemplateLibrary): void {
  currentLibrary = parseVfxTemplateLibrary(library)
}
