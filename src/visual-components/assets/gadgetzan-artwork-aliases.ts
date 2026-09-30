const PREFIX = 'mean_streets_of_gadgetzan_'

/** Share only byte-identical Gadgetzan art; distinct ingredient art stays authored. */
export function resolveGadgetzanArtworkId(cardId: string): string {
  if (!cardId.startsWith(PREFIX)) return cardId
  const suffix = cardId.slice(PREFIX.length)
  const jade = /^jade_golem_([1-9]|[12]\d|30)$/.exec(suffix)
  if (jade) {
    const size = Number(jade[1])
    return `${PREFIX}jade_golem_${size < 4 ? 1 : size < 7 ? 4 : size < 20 ? 7 : 20}`
  }
  const potion = /^kazakus_potion_(1|5|10)_[a-z_]+$/.exec(suffix)
  if (potion) return `${PREFIX}kazakus_potion_${potion[1]}_felbloom_goldthorn`
  switch (suffix) {
    case 'jade_idol_shuffle_choice':
    case 'jade_idol_summon_choice':
      return PREFIX + 'jade_idol'
    case 'kun_armor_choice':
    case 'kun_refresh_choice':
      return PREFIX + 'kun_the_forgotten_king'
    case 'kazakus_demon_5':
    case 'kazakus_demon_8':
      return PREFIX + 'kazakus_demon_2'
    default:
      return cardId
  }
}
