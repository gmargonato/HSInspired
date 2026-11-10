/** Outline widths are authored with the font, before any container/viewport scale. */
export type TextOutlineRole =
  | 'number'
  | 'card-number'
  | 'compact-number'
  | 'label'
  | 'rules-ink'
  | 'rules-light-ink'
  | 'fatigue'
  | 'sleep'

export interface TextOutline {
  readonly color: number
  readonly width: number
  readonly join: 'miter'
  readonly miterLimit: number
}

/** Fresh objects keep per-label color and fitted-size updates independent. */
export function outlinedTextStyle(role: TextOutlineRole, fontSize: number) {
  const rules = role === 'rules-ink' || role === 'rules-light-ink'
  const special = rules || role === 'fatigue' || role === 'sleep'
  let width: number
  let color: number
  switch (role) {
    case 'number':
    case 'compact-number':
      width = Math.max(role === 'compact-number' ? 1 : 0, fontSize * 0.1)
      color = 0x17120f
      break
    case 'card-number':
      width = fontSize * 0.08
      color = 0x17120f
      break
    case 'label':
      width = (fontSize * 7) / 47
      color = 0x000000
      break
    case 'rules-ink':
    case 'rules-light-ink':
      width = 0.75
      color = role === 'rules-ink' ? 0x19130e : 0xffffff
      break
    case 'fatigue':
      width = 3
      color = 0xf1d9ae
      break
    case 'sleep':
      width = 6
      color = 0x0f2a0f
      break
  }
  const stroke: TextOutline = { color, width, join: 'miter', miterLimit: 10 }
  return {
    fontFamily: special ? 'Franklin Gothic Condensed' : 'Belwe',
    fontWeight: rules ? ('normal' as const) : ('bold' as const),
    fontSize,
    stroke
  }
}
