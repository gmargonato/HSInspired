# Hearthstone Deck Code Import Plan

Status: planning/reference document; no importer has been implemented yet.

Last researched: 2026-09-02.

## 1. Goal

Allow a player to copy a Hearthstone deck export from a website or the Hearthstone
client, paste it into HSInspired, and create an ordinary HSInspired deck when all
required cards are available locally.

The important boundary is:

```text
Hearthstone deck code (external DBF IDs)
                  -> import/compatibility layer
                  -> HSInspired CardId and HeroId
                  -> existing deck rules and persistence
```

HSInspired's IDs remain the canonical persisted IDs. Hearthstone DBF IDs are only
foreign import aliases. A saved deck should continue to look like this:

```json
{
  "heroId": "thrall",
  "cards": {
    "basic_fire_elemental": 2,
    "the_grand_tournament_totem_golem": 2
  }
}
```

The importer is an identity translation, not an attempt to reproduce the exact
historical Hearthstone balance patch. If a website shows a 2-mana Rockbiter Weapon
but HSInspired's authored `basic_rockbiter_weapon` costs 1, the imported deck uses
the HSInspired version.

## 2. Current Repository Facts

- Card content uses readable, stable branded string IDs such as
  `basic_fire_elemental`, `classic_feral_spirit`, and
  `naxxramas_zombie_chow`. See
  [`src/game/content/cards/sets/basic.json`](src/game/content/cards/sets/basic.json).
- `CardMetadata.id` is a branded `CardId`; there is currently no Hearthstone DBF
  field in the card schema. See
  [`src/game/content/cards/card-definition.ts`](src/game/content/cards/card-definition.ts).
- `CardCatalog` currently indexes cards only by local `CardId`. See
  [`src/game/content/cards/card-catalog.ts`](src/game/content/cards/card-catalog.ts).
- A persisted deck stores a local `heroId` and a record of local card IDs to copy
  counts. See [`src/game/decks/deck.ts`](src/game/decks/deck.ts).
- `DeckRules` already validates known cards, class restrictions, collectible/deck
  legality, Legendary/non-Legendary copy limits, and the 30-card maximum. See
  [`src/game/decks/deck-rules.ts`](src/game/decks/deck-rules.ts).
- `HeroCatalog.getPrimaryForClass()` can translate an imported Hearthstone class
  into HSInspired's deck-selectable primary hero. See
  [`src/game/content/heroes/hero-catalog.ts`](src/game/content/heroes/hero-catalog.ts).
- The current deck IPC supports list/create/update/delete, but no atomic import.
  See [`src/shared/ipc/decks.ts`](src/shared/ipc/decks.ts).
- The authored set JSON files currently contain 851 card records, including
  generated/non-collectible forms. There are duplicate display names, so display
  name alone is not a safe universal key. Observed duplicate names include Mirror
  Image, The Coin, Druid of the Flame, Imp, Chicken, Light's Justice, Wisp, and
  Druid of the Fang.
- Every card shown in the two research examples already has a corresponding local
  HSInspired card.

Repository rules still apply: the decoder and translator belong in the pure game
domain and must not import Node, Electron, PixiJS, DOM, main, preload, or renderer
implementations.

## 3. What a Hearthstone Deck Code Contains

A Hearthstone deck code is standard Base64 text containing a compact binary
Deckstring payload. It is not encrypted and it is not a hash.

Unless noted otherwise, integer fields use unsigned base-128 varints. In each byte,
the low seven bits contain value data and the high bit means another byte follows.

Conceptually:

```text
value = 0
shift = 0

repeat:
  byte = readByte()
  value |= (byte & 0x7f) << shift
  if (byte & 0x80) == 0: stop
  shift += 7
```

The version-1 payload is:

```text
Header
  reserved marker             one byte, must be 0x00
  version                     varint, currently 1
  format                      varint

Heroes
  hero entry count            varint
  hero DBF IDs                that many varints

Cards appearing once
  entry count                 varint
  card DBF IDs                that many varints

Cards appearing twice
  entry count                 varint
  card DBF IDs                that many varints

Cards with another quantity
  entry count                 varint
  repeated entries            card DBF ID varint, then quantity varint

Sideboards
  presence flag               0x00 or 0x01
  if present, quantity-grouped sideboard entries follow
```

Known format values include `1` for Wild and `2` for Standard. Newer Hearthstone
versions may add formats, so format should be represented as a number plus known
labels rather than making the byte parser unnecessarily fragile.

The sideboard section used by current reference implementations is:

```text
presence = 1

single-copy sideboards
  entry count
  repeated: sideboard card DBF ID, owner card DBF ID

double-copy sideboards
  entry count
  repeated: sideboard card DBF ID, owner card DBF ID

other-quantity sideboards
  entry count
  repeated: sideboard card DBF ID, quantity, owner card DBF ID
```

The main three card lists and hero list are conventionally sorted by ascending DBF
ID to produce a canonical deck code. A decoder should not require that ordering;
it is an encoder consistency rule. The order has no relationship to the cost/name
ordering displayed by a website.

Reference descriptions and implementations:

- <https://hearthsim.info/docs/deckstrings/>
- <https://github.com/HearthSim/python-hearthstone/blob/master/hearthstone/deckstrings.py>
- <https://github.com/HearthSim/hearthstone-deckstrings>
- <https://hearthstonejson.com/>

## 4. Input Accepted by the Future Importer

The user may paste either a bare code or Hearthstone's complete clipboard export:

```text
### Example Deck
# Class: Shaman
# Format: Wild
#
AAEBA...
#
```

The input parser should:

1. Trim whitespace.
2. Ignore lines beginning with `#`.
3. Find exactly one plausible non-comment Base64 deck-code line.
4. Normalize surrounding whitespace but not silently repair arbitrary characters.
5. Optionally collect the `###` title as a suggested deck name.
6. Reject empty input, multiple ambiguous code lines, invalid Base64, truncated
   varints, unsupported versions, unreasonable lengths/counts, and trailing data
   that the selected Deckstring version cannot explain.

The decoder should impose a conservative input-size limit (for example 16 KiB),
cap loop counts before allocation, and reject integers above JavaScript's safe
integer range. A normal constructed deck code is tiny.

## 5. Findings Confirmed by the Examples

### Example A: Priest

Deck code:

```text
AAEBAa0GBB6wFYSfBMGfBA3tAZAC0gr+DYEOvhbHF5CgBMugBPTTBKHUBIakBdKvBwAA
```

Decoded bytes:

```text
00 01 01 01 ad 06 04 1e b0 15 84 9f 04 c1 9f 04
0d ed 01 90 02 d2 0a fe 0d 81 0e be 16 c7 17 90
a0 04 cb a0 04 f4 d3 04 a1 d4 04 86 a4 05 d2 af
07 00 00
```

Header interpretation:

```text
reserved       0
version        1
format         1 (Wild)
hero count     1
hero DBF ID    813 (Priest/Anduin identity)
single entries 4
double entries 13
other entries  0
sideboards     absent
total cards    4 + (13 * 2) = 30
```

Exact card translation fixture:

| Copies | DBF ID | Hearthstone card                    | HSInspired CardId                         |
| -----: | -----: | ----------------------------------- | ----------------------------------------- |
|      1 |     30 | Thoughtsteal                        | `classic_thoughtsteal`                    |
|      1 |   2736 | Justicar Trueheart                  | `the_grand_tournament_justicar_trueheart` |
|      1 |  69508 | Holy Nova (Core printing)           | `classic_holy_nova`                       |
|      1 |  69569 | Shadow Word: Death (Core printing)  | `basic_shadow_word_death`                 |
|      2 |    237 | Auchenai Soulpriest                 | `classic_auchenai_soulpriest`             |
|      2 |    272 | Cabal Shadow Priest                 | `classic_cabal_shadow_priest`             |
|      2 |   1362 | Circle of Healing                   | `classic_circle_of_healing`               |
|      2 |   1790 | Deathlord                           | `naxxramas_deathlord`                     |
|      2 |   1793 | Sludge Belcher                      | `naxxramas_sludge_belcher`                |
|      2 |   2878 | Museum Curator                      | `league_of_explorers_museum_curator`      |
|      2 |   3015 | Entomb                              | `league_of_explorers_entomb`              |
|      2 |  69648 | Injured Blademaster (Core printing) | `classic_injured_blademaster`             |
|      2 |  69707 | Flash Heal (Core printing)          | `the_grand_tournament_flash_heal`         |
|      2 |  76276 | Northshire Cleric (Core printing)   | `basic_northshire_cleric`                 |
|      2 |  76321 | Wild Pyromancer (Core printing)     | `classic_wild_pyromancer`                 |
|      2 |  86534 | Lightbomb (Core printing)           | `goblins_vs_gnomes_lightbomb`             |
|      2 | 120786 | Power Word: Shield (Core printing)  | `basic_power_word_shield`                 |

Imported hero resolution should be:

```text
813 -> Priest -> HERO_CATALOG.getPrimaryForClass('Priest') -> anduin
```

### Example B: Shaman

Deck code:

```text
AAEBAaa0BgqQELcUr58E+p8E/p8E/58EgKAEpNQE8t0EyJ4GCtkN9Q3RE4yfBI2fBP2fBJ+gBNGgBIbUBLn2BwAA
```

Decoded bytes:

```text
00 01 01 01 a6 b4 06 0a 90 10 b7 14 af 9f 04 fa
9f 04 fe 9f 04 ff 9f 04 80 a0 04 a4 d4 04 f2 dd
04 c8 9e 06 0a d9 0d f5 0d d1 13 8c 9f 04 8d
9f 04 fd 9f 04 9f a0 04 d1 a0 04 86 d4 04 b9 f6
07 00 00
```

Header interpretation:

```text
reserved       0
version        1
format         1 (Wild)
hero count     1
hero DBF ID    104998
single entries 10
double entries 10
other entries  0
sideboards     absent
total cards    10 + (10 * 2) = 30
```

Exact card translation fixture:

| Copies | DBF ID | Hearthstone card                     | HSInspired CardId                            |
| -----: | -----: | ------------------------------------ | -------------------------------------------- |
|      1 |   2064 | Piloted Shredder                     | `goblins_vs_gnomes_piloted_shredder`         |
|      1 |   2615 | Thunder Bluff Valiant                | `the_grand_tournament_thunder_bluff_valiant` |
|      1 |  69551 | Hex (Core printing)                  | `basic_hex`                                  |
|      1 |  69626 | Feral Spirit (Core printing)         | `classic_feral_spirit`                       |
|      1 |  69630 | Doomhammer (Core printing)           | `classic_doomhammer`                         |
|      1 |  69631 | Mana Tide Totem (Core printing)      | `classic_mana_tide_totem`                    |
|      1 |  69632 | Al'Akir the Windlord (Core printing) | `classic_alakir_the_windlord`                |
|      1 |  76324 | Azure Drake (Core printing)          | `classic_azure_drake`                        |
|      1 |  77554 | Bloodlust (Core printing)            | `basic_bloodlust`                            |
|      1 | 102216 | Dr. Boom (Core printing)             | `goblins_vs_gnomes_dr_boom`                  |
|      2 |   1753 | Zombie Chow                          | `naxxramas_zombie_chow`                      |
|      2 |   1781 | Haunted Creeper                      | `naxxramas_haunted_creeper`                  |
|      2 |   2513 | Tuskarr Totemic                      | `the_grand_tournament_tuskarr_totemic`       |
|      2 |  69516 | Fire Elemental (Core printing)       | `basic_fire_elemental`                       |
|      2 |  69517 | Rockbiter Weapon (Core printing)     | `basic_rockbiter_weapon`                     |
|      2 |  69629 | Lightning Storm (Core printing)      | `classic_lightning_storm`                    |
|      2 |  69663 | Defender of Argus (Core printing)    | `classic_defender_of_argus`                  |
|      2 |  69713 | Nerubian Egg (Core printing)         | `naxxramas_nerubian_egg`                     |
|      2 |  76294 | Flametongue Totem (Core printing)    | `basic_flametongue_totem`                    |
|      2 | 129849 | Totem Golem (Core printing)          | `the_grand_tournament_totem_golem`           |

Hero DBF ID `104998` is Fire Festival Ragnaros, an uncollectible Tavern Brawl
Shaman hero. This proves that the hero field is a specific initial-hero DBF record,
not a small class enum and not necessarily a normal collectible hero skin. The
importer should resolve its class and choose HSInspired's primary hero:

```text
104998 -> Shaman -> HERO_CATALOG.getPrimaryForClass('Shaman') -> thrall
```

Reference: <https://hearthstone.wiki.gg/wiki/Fire_Festival_Ragnaros>

### Conclusions from both examples

1. The format, varint behavior, quantity grouping, and final sideboard marker are
   confirmed.
2. Cards are sorted by numeric DBF ID inside quantity groups, not in website display
   order.
3. A deck code stores exact card printings. Original, Legacy, Classic, Core, and
   other reprints may have different DBF IDs despite representing the same local
   card identity.
4. Closely numbered Core DBF IDs produce similar-looking byte/Base64 fragments;
   those fragments are not duplicate card records.
5. A website may normalize multiple official printings to the same displayed card
   name.
6. The hero record must be mapped to a class; it should not be assumed to be Thrall,
   Anduin, or another base portrait.
7. The last two zeroes in both examples have separate meanings: zero unusual-copy
   entries, followed by no sideboards.

## 6. Recommended Compatibility Map

Keep Hearthstone interoperability data separate from the core `CardDefinition`
schema. A proposed checked-in file is:

```text
src/game/decks/hearthstone-deck-code-map.json
```

A local-ID-centric shape is easiest to review and allows all official aliases to
be declared together:

```json
{
  "cardAliases": {
    "basic_fire_elemental": [189, 69516],
    "basic_hex": [766, 69551],
    "the_grand_tournament_totem_golem": [2610, 129849]
  },
  "heroClassAliases": {
    "Priest": [813],
    "Shaman": [1066, 104998]
  }
}
```

At catalog construction time, validate every local card ID and class, then invert
the arrays into efficient read-only maps:

```text
Map<dbfId, CardId>
Map<heroDbfId, DeckClass>
```

Construction must fail on duplicate DBF aliases so an external ID can never map
silently to two local identities.

Why this is preferred over changing every card JSON record:

- It keeps foreign interoperability metadata out of gameplay definitions.
- It avoids changing `CardMetadata`, raw record validation, and 851 authored card
  records for an import-only concern.
- It gives reviewers one auditable compatibility index.
- Reprint aliases can be added without changing gameplay content.

The map may initially be generated with tooling, but the result should be committed
and deterministic at runtime. Do not require internet access when a player imports
a deck.

### Building and maintaining the map

HearthstoneJSON can provide DBF ID, stable string card ID, name, class, set, and
game tags. Reprints often expose a canonical/original identity through tags such as
`DECK_RULE_COUNT_AS_COPY_OF_CARD_ID` (shown as numeric tag `858` in extracted card
data). A development-only generator can use these signals to propose aliases:

1. Load a pinned HearthstoneJSON snapshot.
2. Restrict HSInspired candidates to collectible, deck-legal local cards.
3. Match exact official card identity/set when known.
4. Follow official copy/reprint links to collect alias DBF IDs.
5. Use normalized name/class as a proposal only, never an unquestioned final key.
6. Report ambiguous and missing entries for manual review.
7. Emit a stable, sorted JSON map and an audit report.
8. Commit the reviewed result; runtime code reads only the committed compact map.

Name-only matching is unsafe as the primary runtime strategy because names can be
duplicated, renamed, localized, or attached to generated forms. It is acceptable as
a generator aid or an explicitly reported fallback.

## 7. Pure Domain API Design

Suggested files:

```text
src/game/decks/hearthstone-deck-code.ts
src/game/decks/hearthstone-deck-code-map.json
src/game/decks/hearthstone-deck-code.test.ts
```

Keep byte decoding separate from local translation so each concern is independently
testable:

```ts
interface DecodedHearthstoneDeckCode {
  readonly version: number
  readonly format: number
  readonly heroDbfIds: readonly number[]
  readonly cards: readonly {
    readonly dbfId: number
    readonly count: number
  }[]
  readonly sideboards: readonly {
    readonly dbfId: number
    readonly count: number
    readonly ownerDbfId: number
  }[]
}

interface HearthstoneDeckImportDraft {
  readonly suggestedName?: string
  readonly format: number
  readonly heroClass?: DeckClass
  readonly heroId?: HeroId
  readonly cards: Readonly<Record<string, number>>
  readonly unresolvedCardDbfIds: readonly number[]
  readonly unresolvedHeroDbfIds: readonly number[]
  readonly warnings: readonly string[]
}

function decodeHearthstoneDeckCode(input: string): DecodedHearthstoneDeckCode

function translateHearthstoneDeckCode(
  decoded: DecodedHearthstoneDeckCode
): HearthstoneDeckImportDraft
```

The pure layer should not create UUIDs, read the clock, persist files, or display UI.

### Alias merging

Translate and merge before applying copy-limit validation:

```text
external DBF A -> local_card_x, count 1
external DBF B -> local_card_x, count 1
result         -> local_card_x, count 2
```

This matters if a code contains original and Core printings that Hearthstone counts
as copies of the same identity.

## 8. Application, IPC, and Persistence

Do not implement import as `create(empty)` followed by `update(cards)`. If the second
operation fails, it leaves an unintended empty deck.

Preferred flow:

1. Renderer collects pasted text.
2. Pure decoder/translator produces a preview draft.
3. UI displays hero, resolved cards, and all warnings/errors.
4. On confirmation, send one validated import request.
5. Main/repository assigns deck ID and timestamps, validates the complete local
   deck, and persists it atomically.

Two viable contract designs are:

- Add a dedicated `decks:import` IPC channel and `DeckImportRequest`; this is the
  clearest representation of the workflow.
- Extend `DeckCreateRequest` with optional initial cards and use it for an atomic
  populated create. This is smaller but makes the general create request broader.

The dedicated import operation is recommended because it can return structured
translation diagnostics without complicating ordinary empty-deck creation.

Persist only the translated local deck. The original deck code may optionally be
kept as non-authoritative provenance later, but should not be required to load or
play the deck.

## 9. Import Policy and User Experience

Recommended defaults:

- Preview before saving.
- Never silently drop an unsupported card.
- Require all main-deck DBF IDs to resolve for a normal successful import.
- Show unsupported card names when bundled metadata knows them; otherwise show the
  numeric DBF IDs.
- Map any known alternate/special hero to its class and select the primary local
  hero.
- Fail clearly when the hero DBF ID cannot be mapped. Do not infer class from cards
  as the only strategy because neutral-only decks are ambiguous.
- Treat the external format as informational initially. HSInspired's current `Deck`
  model has no Standard/Wild field.
- Reject sideboard deck codes initially with a clear `sideboards are not supported`
  message. Silently ignoring sideboards would change a deck's meaning.
- Apply `DeckRules` after alias merging.
- Preserve HSInspired's authored stats, text, rarity, and effects.
- If the pasted title exceeds `MAX_DECK_NAME_LENGTH`, show a proposed truncation or
  ask the user to edit it rather than silently persisting an invalid name.

An optional later action could import only supported cards as an explicitly partial
deck. It should not be the default, and the preview must identify every omitted
card. The current deck rules allow fewer than 30 cards, so such a workflow is
technically possible.

## 10. Approaches Considered

### A. Separate explicit DBF compatibility index — recommended

Advantages:

- Exact and deterministic.
- Supports multiple official printings per local card.
- Runtime works offline.
- Does not change local persistence or gameplay identity.
- Easy to audit and test.

Cost: the map must be generated/reviewed and maintained as new official reprints
appear.

### B. Add DBF alias arrays to every card JSON record

Example:

```json
{
  "id": "basic_fire_elemental",
  "hearthstoneDbfIds": [189, 69516]
}
```

Advantages: aliases live beside the card and are easy to discover.

Disadvantages: foreign integration metadata enters the core schema, the validator
and types need changes, and many content files become noisier. This is viable, but
less isolated than a dedicated map.

### C. Runtime name matching against HearthstoneJSON

Advantages: potentially recognizes newly released DBF IDs without a local alias
update.

Disadvantages: network/version dependence, localization, duplicate names, renamed
cards, tokens, and balance/version ambiguity. Do not use this as the authoritative
runtime path.

### D. Bundle the full Hearthstone database

Advantages: excellent unsupported-card names and metadata; can classify nearly any
hero or card.

Disadvantages: larger frequently changing third-party dataset and more update work.
A compact generated compatibility index is sufficient for the first version.

### E. Use a third-party Deckstring codec package

This can reduce codec code, but does not solve DBF-to-local-ID translation. The
binary codec is small enough to implement and test locally. If a package is chosen,
verify browser/Electron compatibility and ensure it does not introduce Node globals
into `src/game`.

## 11. Implementation Phases

### Phase 1: Pure decoding

- Add complete-export text extraction.
- Add strict Base64 decoding without Node or DOM dependencies.
- Add unsigned varint reader with bounds checks.
- Decode version 1 header, heroes, all three card quantity groups, and sideboards.
- Add both researched codes as exact fixtures.

### Phase 2: Compatibility translation

- Add the checked-in alias map and schema validation.
- Populate aliases for all currently deck-legal HSInspired cards.
- Add DBF-to-local and hero-DBF-to-class indexes.
- Merge aliases before validation.
- Return structured unresolved/warning information.

### Phase 3: Atomic domain/application import

- Define `DeckImportRequest` and result contracts.
- Add a repository/application operation that creates the populated deck atomically.
- Resolve imported class through `HERO_CATALOG.getPrimaryForClass()`.
- Reuse `DeckRules` for final local validation.
- Add IPC/runtime validation for the new operation.

### Phase 4: Collection UI

- Add an Import Deck action and paste dialog/view.
- Display decoded hero, card count, resolved list, unsupported cards, and warnings.
- Require explicit confirmation only after a valid preview.
- Refresh/select the newly imported deck after persistence.
- Follow the repository layout contract for any new Pixi objects and labels.

### Phase 5: Mapping maintenance tooling

- Add a development-only HearthstoneJSON mapping/audit script.
- Pin the source data version used for each regeneration.
- Fail the audit on duplicate DBF aliases, missing local IDs, or invalid hero classes.
- Document the update workflow.

## 12. Test Plan

### Codec tests

- Decode both researched examples exactly.
- Re-encode decoded canonical data to the same Base64 strings if export is added.
- Accept a bare code and a full commented clipboard export.
- Decode one-, two-, and `n`-copy groups.
- Decode sideboard records even if translation later rejects them.
- Verify multi-byte varints including DBF IDs 104998, 120786, and 129849.
- Reject nonzero reserved marker, unsupported version, invalid Base64, truncated
  varint, unsafe integer, missing group, absurd count, and unexplained trailing data.

### Mapping tests

- Every alias maps to an existing local `CardId`.
- Every hero alias maps to a playable HSInspired class.
- No DBF ID appears under multiple local identities.
- Original and Core aliases resolve to the same local card.
- Two aliases for the same local card merge their quantities.
- Unknown card and hero DBF IDs remain explicit unresolved entries.

### Domain/import tests

- Example A produces Anduin and the exact 30-card local Priest deck.
- Example B produces Thrall and the exact 30-card local Shaman deck.
- Class-incompatible mapped cards fail validation.
- Merged copies over the local rarity limit fail validation.
- Unsupported cards prevent default import.
- Sideboards prevent initial-version import with a targeted error.
- External balance differences do not overwrite local card definitions.

### IPC/repository tests

- A successful import persists exactly once.
- A failed import leaves no empty or partial deck.
- Deck name length and request parsing are validated.
- Concurrent imports remain serialized by the repository mutation queue.

### UI tests

- Preview shows resolved and unresolved counts.
- Confirmation is disabled for a strict invalid import.
- Successful import selects or visibly exposes the new deck.
- Cancel performs no mutation.

## 13. Open Product Decisions

These do not block the codec work but should be settled before UI completion:

1. Should a complete import require exactly 30 cards, or accept any locally valid
   partial deck up to 30? Recommended: require the source quantities to total 30 for
   a normal constructed import, while leaving an explicit partial option for later.
2. Should an imported `###` title be truncated, edited in preview, or replaced with
   the next default deck name? Recommended: prefill an editable valid name.
3. Should unknown Hearthstone cards show only DBF IDs, or should a compact metadata
   index be bundled for names? Recommended first version: known mappings plus DBF
   IDs; add metadata if unsupported-deck UX proves poor.
4. Should the source format be persisted? Recommended: not initially, because local
   legality is defined by HSInspired rather than Hearthstone rotation rules.
5. Should HSInspired eventually export Hearthstone-compatible codes? This requires
   selecting one preferred external DBF ID per local card and should be treated as a
   separate feature from import.
6. How should future sideboards be represented locally? Do not answer this by
   discarding them during import.

## 14. Success Criteria

The first implementation is complete when:

- A user can paste either researched code, preview it, and create the correct local
  30-card deck.
- Internal deck files contain only HSInspired `CardId` and `HeroId` values.
- Original/Core reprints map to the same local identity.
- Special hero DBF IDs map through class to a local primary hero.
- Unsupported cards, heroes, formats/versions, malformed payloads, and sideboards
  produce specific non-destructive errors.
- A failed import creates or changes nothing.
- Pure-domain boundaries and the existing dependency rules remain satisfied.
- Focused codec, mapping, rules, IPC/repository, and UI tests cover the behavior.
