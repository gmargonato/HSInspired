# Persistent minion aura reference

Recovered from the local Hearthstone installation on 2026-10-19.

## Source chain

The shared `Card_Play_Ally_SpellTable` maps `SpellType.AURA` (75) to
`Card_Play_Ally_Aura.prefab:9b887018aea40483ea0d13267fb22d86`.
The tag-visual configuration maps tag 362 to this spell's birth/removal states.
This is the standard persistent minion aura, distinct from summon effects and
the separate `Card_Play_Ally_Aura_Echo` and hero echo prefabs.

- Prefab: `initial_base_global-2ebe64b8-prefab-4.unity3d`, root
  `5367463534442789527`, particle `FX_AuraGlow` / `-8491537080923440489`.
- Material: `initial_base_global-41caf0cf-material-0.unity3d`,
  `GenFX_AllyInPlay_Aura1` / `-2090062063891161141`.
- Shader: `Hero/Additive/Additive` / `-666151408197827071`, the same recovered
  additive program used in the Ghost investigation.
- Texture: `essential_base_global-texture-3.unity3d`, `GenFX_Aura1` /
  `2168342575309436212`, 256 x 256.
- Extracted PNG: `card_related/png/card_effects_and_ui/fc5417347d92/GenFX_Aura1__ed1f20da0f4b.png`.
- Runtime copy: `assets/images/effects/minion-aura-glow.png`.
- PNG SHA256: `f2813a6f7837a85059f063cb1e863f244c70c7924434ddbcd561aeb424c10ebd`.

## Rendering and timing

One stationary particle bursts at time zero of each four-second loop. It lives
2.5 seconds, leaving 1.5 seconds without a visible particle. There is no separate
continuous glow in this prefab. Birth starts the system without prewarming.

Maximum size is six Unity units. The normalized size curve has keys (0, 0) and
(1, 1), with outgoing tangent 2.10730242729187 and incoming tangent zero.
Opacity holds at one through normalized age 23928/65535, then falls linearly to
zero at age one. Particle RGB is 217/255; material tint is
(0.4549019635, 0.3370781541, 0.1320107579, 1).

The shader multiplies texture, particle color and twice the material tint, then
blends SrcAlpha/One. Both RGB and alpha are doubled in the vertex shader; the
pixel shader multiplies that result by the texture. The PNG has uniformly opaque
alpha. A premultiplied Pixi additive sprite uses the RGB gain and
`min(1, 2 * particleAlpha)` to reproduce the source blend without a custom shader.

The horizontal particle plane is mapped against `Card_InPlay_Ally_mesh`
(`essential_base_global-mesh-0.unity3d`, `4184179661576611529`). Its X/Z bounds are
1.5057759285 x 1.99072265625, centered at (-0.0177951753, -0.0546280146).
The particle's position is (X 0.0620379448, Z 0.0551452637).
`MINION_LAYOUT.aura` maps the source size to the existing 119 x 161 frame.
Visual alignment uses the frame center (80, 90). Applying the native X/Z offset
placed the halo high and right in this 2D view. Two rounds of matched-time captures
compared the original position, centering and small horizontal/vertical offsets;
the centered position gave the most balanced halo around the frame.
This is a 2D projection adaptation; the port
does not reproduce Unity's full board camera, tiny 0.01-unit emitter jitter or
depth-buffer interactions. No additional bloom or invented steady glow is added.

## Integration

The game bundle retains the `scene.game.minion-aura` key and `minionAura` alias.
Only their image and authored dimensions change. The old placeholder file is
retained, but no longer imported. `MinionViewModel.aura` and texture injection
remain compatible with the board and existing inspectors.

The effect sits behind all minion surfaces, cannot receive pointer events and is
excluded from shadow silhouettes. Minion targeting and hover-preview placement use
physical hit-area bounds; render bounds still include the glow for combat snapshots.
Eligibility comes from the card's explicit `auraVisual` metadata (see the audit
below). Silence clears the authored marker. Dormancy and pending destruction
suppress presentation.
Repeated state refreshes preserve phase; disable clears the particle and stops
its clock, re-enable starts a fresh cycle, and destruction releases the clock and
sprite without destroying the shared texture. Its clock is cosmetic and consumes
no match RNG. The implementation has one sprite and one animation per active aura.

## Whole-catalog eligibility audit

The installed `Data/Win/dbf.unity3d` contains the `CARD` and `CARD_TAG`
ScriptableObjects. `CARD.m_noteMiniGuid` connects original card IDs to numeric
DBF IDs; `CARD_TAG.m_cardId` joins these to `m_tagId = 362` (`GAME_TAG.AURA`).
`EntityDef.LoadBatchCardEntityDefs` loads these tags through
`GameUtils.TryGetCardTagRecords`. The visual configuration described above maps
that exact tag to the recovered aura prefab.

DBF SHA256: `8f5ddc1002c9dd7bb417aa821440a0f672175de6fc05ea0f4b576bd7a7934d7b`.

The audit covers all 1,844 catalog entries: 1,117 minions (920 collectible),
with the other card types outside this minion visual's scope. The artwork source
manifest supplies original IDs for 1,089 minions; all resolve in the DBF, and
multiple IDs for a card agree. The remaining 28 are generated Jade Golem and
Kazakus Demon stat variants with no effects, so they have no source aura.
[The full minion audit](minion-aura-catalog.csv) records every inclusion and exclusion.

35 minions have the native tag; 1,082 do not. Compared with the original heuristic,
20 missing sources gain the glow and four false positives lose it. These are the
35 eligible sources, including the non-collectible Leokk:

| Set                          | Minions with the aura glow                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic                        | Flametongue Totem, Grimscale Oracle, Raid Leader, Stormwind Champion, Timber Wolf                                                                                          |
| Classic                      | Dire Wolf Alpha, Leokk, Mana Wraith, Murloc Warleader, Pint-Sized Summoner, Sorcerer's Apprentice, Southsea Captain, Summoning Portal, Tundra Rhino, Venture Co. Mercenary |
| Goblins vs Gnomes            | Wee Spellstopper, Mal'Ganis, Mechwarper                                                                                                                                    |
| Naxxramas                    | Nerub'ar Weblord, Baron Rivendare                                                                                                                                          |
| League of Explorers          | Naga Sea Witch, Brann Bronzebeard                                                                                                                                          |
| The Grand Tournament         | Aviana, Warhorse Trainer, Maiden of the Lake                                                                                                                               |
| One Night in Karazhan        | Violet Illusionist                                                                                                                                                         |
| Whispers of the Old Gods     | Fandral Staghelm                                                                                                                                                           |
| Journey to Un'Goro           | Radiant Elemental, Emerald Hive Queen                                                                                                                                      |
| Knights of the Frozen Throne | Doomed Apprentice, Runeforge Haunter, Corpse Widow, Nerubian Unraveler, Drakkari Enchanter                                                                                 |
| Future Past                  | Sing-Along Buddy                                                                                                                                                           |

Coldarra Drake, Garrison Commander, Mindbreaker and Mogor the Ogre were false
positives. Other deliberately excluded passive effects include Auchenai Soulpriest,
Prophet Velen, Steamwheedle Sniper, Jungle Moonkin, Animated Armor, Fallen Hero,
Wilfred Fizzlebang, Bolf Ramshield, Cloaked Huntress, Blackwater Pirate and Mayor
Noggenfogger: none has the native AURA tag. Self-buffs, Enrage, the Tar minions,
ordinary Spell Damage and triggered abilities also do not imply this glow.
Pint-Sized Summoner demonstrates the reverse: it has the tag even though our
rules express its discount through a turn trigger instead of an aura action.

`auraVisual` is optional, validated boolean content metadata, separate from
gameplay effects. Missing means false; new cards require an explicit eligibility
decision. Zombeasts inherit the tag along with their first component's effects
(the second pool has no effects), including Timber Wolf and Dire Wolf Alpha.
Buff recipients do not acquire it. The tag denotes the source, even when there
are no eligible recipients; it is not recalculated from the number of targets.

This comparison verifies authored tags in the installed client, not every
server-driven tag transition or every historical client version. Card balance,
costs and gameplay effects remain unchanged.

## Validation

The existing minion presentation suite covers the recovered timing curve, material
alpha gain, layering, unchanged phase on state refresh, physical interaction bounds,
dormancy, pending destruction and teardown. It also exercises creation, silence,
restoration and transformation for all 35 aura sources. The marker suite checks
the exact eligible set across the whole minion catalog, Zombeast inheritance and
visual-tag validation. Together with the content capability suite, 147 tests pass.
Type checking, targeted lint and dependency checks also pass after the eligibility
change. No full application launch or build was repeated for this metadata pass.

An additional isolated WebGL preview renders Stormwind Champion, Sorcerer's
Apprentice, Brann and Sing-Along Buddy with auras, alongside Coldarra Drake,
Mogor, Cloaked Huntress and Hogger without them. All nine checks pass, including
animation cleanup. Both 1.25-second and two-second captures were visually
inspected; captures and the report are under `.tmp/minion-aura-catalog-check`.

An isolated Electron/WebGL check exercises the actual `MinionView` with Stormwind
Champion art, normal/premium frames and Taunt/Divine Shield. Its 15 checks pass,
including an independent source-equation pixel probe (RGB 124, 92, 36 at age two
seconds). Local frames at 0, 0.5, 1.25, 2, 2.5, 3.9 and 4.5 seconds and the result
report are under `.tmp/minion-aura-check`.

The initial visual port passed type checking, targeted lint, dependency checks
and the production build. That rebuilt application also passed an isolated-profile smoke test through the
main menu, Tavern Brawl, mulligan confirmation, turn play, pointer input and return
to the menu, with no renderer or preload errors. Its report is in
`.tmp/minion-aura-boot/report.json`.
