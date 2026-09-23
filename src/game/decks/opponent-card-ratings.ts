/** Reusable suitability judgments, not deck lists. Mechanics still come from the catalog. */
export const OPPONENT_CARD_RATINGS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(
    [
      [2, `basic_stormpike_commando mean_streets_of_gadgetzan_wind_up_burglebot`],
      [
        5,
        `classic_azure_drake classic_savannah_highmane classic_tirion_fordring
        goblins_vs_gnomes_piloted_shredder goblins_vs_gnomes_dr_boom
        naxxramas_sludge_belcher naxxramas_haunted_creeper
        basic_fire_elemental basic_fiery_war_axe basic_swipe basic_fireball
        basic_frostbolt classic_si_7_agent classic_keeper_of_the_grove
        whispers_of_the_old_gods_possessed_villager`
      ],
      [
        4,
        `classic_argent_squire classic_argent_commander classic_cairne_bloodhoof
        basic_shadow_word_pain basic_shadow_word_death classic_druid_of_the_claw
        classic_sunwalker classic_harvest_golem classic_loot_hoarder
        classic_faerie_dragon classic_knife_juggler classic_defender_of_argus
        classic_dire_wolf_alpha classic_southsea_captain classic_murloc_warleader
        classic_violet_teacher classic_frothing_berserker classic_acolyte_of_pain
        classic_cruel_taskmaster classic_grommash_hellscream classic_flame_imp
        classic_animal_companion classic_power_of_the_wild classic_wrath
        classic_lightning_bolt classic_feral_spirit classic_siphon_soul
        classic_silver_hand_knight classic_stranglethorn_tiger
        classic_mana_wyrm classic_sorcerers_apprentice classic_kill_command
        classic_abusive_sergeant classic_power_overwhelming
        classic_noble_sacrifice classic_redemption naxxramas_avenge
        classic_freezing_trap classic_explosive_trap classic_counterspell classic_mirror_entity
        basic_water_elemental basic_houndmaster basic_hex basic_shadow_bolt
        basic_korkron_elite basic_flametongue_totem basic_shattered_sun_cleric
        classic_truesilver_champion basic_consecration basic_arcane_intellect
        goblins_vs_gnomes_mechwarper goblins_vs_gnomes_spider_tank
        goblins_vs_gnomes_snowchugger goblins_vs_gnomes_annoy_o_tron
        goblins_vs_gnomes_goblin_blastmage goblins_vs_gnomes_tinkertown_technician
        goblins_vs_gnomes_screwjank_clunker goblins_vs_gnomes_ships_cannon
        goblins_vs_gnomes_bomb_lobber goblins_vs_gnomes_piloted_sky_golem
        goblins_vs_gnomes_toshley goblins_vs_gnomes_shieldmaiden
        goblins_vs_gnomes_darkbomb goblins_vs_gnomes_muster_for_battle
        goblins_vs_gnomes_quartermaster goblins_vs_gnomes_powermace
        blackrock_mountain_blackwing_technician blackrock_mountain_blackwing_corruptor
        blackrock_mountain_imp_gang_boss blackrock_mountain_fireguard_destroyer
        the_grand_tournament_twilight_guardian the_grand_tournament_wyrmrest_agent
        the_grand_tournament_alexstraszas_champion the_grand_tournament_totem_golem
        the_grand_tournament_thunder_bluff_valiant the_grand_tournament_bash
        league_of_explorers_tunnel_trogg league_of_explorers_dark_peddler
        league_of_explorers_fierce_monkey league_of_explorers_huge_toad
        one_night_in_karazhan_kindly_grandmother one_night_in_karazhan_netherspite_historian
        one_night_in_karazhan_book_wyrm one_night_in_karazhan_maelstrom_portal
        whispers_of_the_old_gods_darkshire_councilman whispers_of_the_old_gods_bloodhoof_brave
        whispers_of_the_old_gods_ravaging_ghoul whispers_of_the_old_gods_infested_wolf
        whispers_of_the_old_gods_thing_from_below whispers_of_the_old_gods_nzoths_first_mate
        mean_streets_of_gadgetzan_jade_spirit mean_streets_of_gadgetzan_jade_claws
        mean_streets_of_gadgetzan_jade_lightning mean_streets_of_gadgetzan_aya_blackpaw
        mean_streets_of_gadgetzan_jade_chieftain mean_streets_of_gadgetzan_jade_behemoth
        mean_streets_of_gadgetzan_jade_blossom mean_streets_of_gadgetzan_jade_shuriken
        mean_streets_of_gadgetzan_crystalweaver mean_streets_of_gadgetzan_kabal_talonpriest
        mean_streets_of_gadgetzan_drakonid_operative`
      ],
      [
        0,
        `one_night_in_karazhan_purify
        classic_mad_bomber goblins_vs_gnomes_madder_bomber
        whispers_of_the_old_gods_nat_the_darkfisher
        whispers_of_the_old_gods_blood_of_the_ancient_one
        whispers_of_the_old_gods_chogall one_night_in_karazhan_prince_malchezaar
        the_grand_tournament_icehowl league_of_explorers_cursed_blade
        classic_prophet_velen classic_malygos`
      ],
      [
        3,
        `basic_gnomish_inventor basic_boulderfist_ogre basic_senjin_shieldmasta
        one_night_in_karazhan_runic_egg classic_repentance
        whispers_of_the_old_gods_disciple_of_cthun whispers_of_the_old_gods_cthuns_chosen
        whispers_of_the_old_gods_twilight_elder
        basic_murloc_tidehunter basic_razorfen_hunter basic_dragonling_mechanic
        basic_stormwind_champion basic_bloodlust basic_northshire_cleric
        classic_cult_master classic_earthen_ring_farseer classic_bloodsail_raider
        classic_southsea_deckhand classic_coldlight_seer classic_murloc_tidecaller
        classic_spiteful_smith classic_battle_rage classic_slam classic_inner_rage
        classic_mark_of_nature basic_blessing_of_kings basic_blessing_of_might
        naxxramas_nerubian_egg naxxramas_dark_cultist naxxramas_deaths_bite
        goblins_vs_gnomes_clockwork_gnome goblins_vs_gnomes_micro_machine
        goblins_vs_gnomes_antique_healbot goblins_vs_gnomes_mechanical_yeti
        goblins_vs_gnomes_iron_sensei goblins_vs_gnomes_junkbot
        basic_assassins_blade classic_perditions_blade goblins_vs_gnomes_cogmasters_wrench
        one_night_in_karazhan_sharp_fork the_grand_tournament_poisoned_blade
        league_of_explorers_tomb_spider league_of_explorers_gorillabot_a_3
        the_grand_tournament_draenei_totemcarver the_grand_tournament_tuskarr_totemic
        the_grand_tournament_orgrimmar_aspirant
        one_night_in_karazhan_kara_kazham one_night_in_karazhan_deadly_fork
        whispers_of_the_old_gods_undercity_huckster`
      ]
    ].flatMap(([rating, ids]) =>
      String(ids)
        .trim()
        .split(/\s+/u)
        .map((id) => [id, Number(rating)])
    )
  )
)

/** These small self-damage effects are deliberate tempo tools, not accidental drawbacks. */
export const REVIEWED_FRIENDLY_DAMAGE = new Set([
  'classic_flame_imp',
  'classic_cruel_taskmaster',
  'classic_inner_rage',
  'naxxramas_deaths_bite',
  'whispers_of_the_old_gods_ravaging_ghoul'
])
