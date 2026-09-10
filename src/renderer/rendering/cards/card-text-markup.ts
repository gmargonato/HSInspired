const HEARTHSTONE_KEYWORDS = [
  'Divine Shield',
  'Spell Damage',
  'Choose One',
  'Battlecry',
  'Deathrattle',
  'Windfury',
  'Poisonous',
  'Elusive',
  'Enrage',
  'Lifesteal',
  'Overload',
  'Discover',
  'Silence',
  'Taunt',
  'Charge',
  'Rush',
  'Stealth',
  'Freeze',
  'Secret',
  'Combo',
  'Immune'
] as const

function escapeTextMarkup(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const keywordPattern = new RegExp(
  `\\b(${[...HEARTHSTONE_KEYWORDS]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp)
    .join('|')})(?::)?(?=\\b|\\s|[.,!?])`,
  'gi'
)

export function markHearthstoneKeywords(text: string): string {
  return escapeTextMarkup(text).replace(
    keywordPattern,
    (match) => `<keyword>${match}</keyword>`
  )
}
