import { CARD_CATALOG } from '../../game-rules/content/cards'
import { HERO_POWER_CATALOG } from '../../game-rules/content/hero-powers'
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

/** Check authored references without supplying defaults or importing visuals into rules. */
export function validateVfxReferences(
  value: unknown,
  library: VfxTemplateLibrary
): void {
  const ids = new Set(library.templates.map((template) => template.id))
  const visit = (entry: unknown): void => {
    if (!entry || typeof entry !== 'object') return
    for (const [key, child] of Object.entries(entry)) {
      if (key === 'vfx' && (typeof child !== 'string' || !ids.has(child)))
        throw new Error('Unknown authored VFX template: ' + String(child))
      if (child && typeof child === 'object') visit(child)
    }
  }
  visit(value)
}

function validatedLibrary(value: unknown): VfxTemplateLibrary {
  const library = parseVfxTemplateLibrary(value)
  validateVfxReferences(CARD_CATALOG.all, library)
  validateVfxReferences(HERO_POWER_CATALOG.all, library)
  return library
}

let currentLibrary = validatedLibrary(rawLibrary)

export function getVfxTemplate(id: string): VfxTemplate | undefined {
  const template = currentLibrary.templates.find((item) => item.id === id)
  return template ? structuredClone(template) : undefined
}

export function getVfxTemplateLibrary(): VfxTemplateLibrary {
  return structuredClone(currentLibrary)
}

/** Keep this session in sync after the development editor saves successfully. */
export function updateVfxTemplateLibrary(library: VfxTemplateLibrary): void {
  currentLibrary = validatedLibrary(library)
}
