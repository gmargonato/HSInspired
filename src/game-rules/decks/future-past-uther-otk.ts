import { asHeroId } from '../content/cards'
import type { Deck } from './deck'

/**
 * Approved player recipe: Buddy 3 mana (2/4), Order 4 mana, Uther 8 mana.
 * With Uther active, Buddy + Commander + two hero powers costs 9 mana.
 * Independent of the curated AI opponent pool.
 */
export const FUTURE_PAST_UTHER_OTK_DECK: Deck = {
  id: 'future-past-uther-otk',
  name: 'Uther OTK',
  heroId: asHeroId('uther'),
  cards: {
    future_past_animated_broomstick: 2,
    future_past_armor_vendor: 2,
    future_past_critter_caretaker: 2,
    future_past_depth_charge: 2,
    future_past_dragonscale_armaments: 2,
    future_past_knight_of_anointment: 2,
    future_past_miracle_salesman: 2,
    mean_streets_of_gadgetzan_mistress_of_mixtures: 2,
    future_past_peasant: 2,
    knights_of_the_frozen_throne_righteous_protector: 2,
    naxxramas_zombie_chow: 2,
    the_grand_tournament_garrison_commander: 2,
    future_past_order_in_the_court: 2,
    future_past_sing_along_buddy: 2,
    future_past_nozdormu_the_timeless: 1,
    knights_of_the_frozen_throne_uther_of_the_ebon_blade: 1
  },
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z'
}
