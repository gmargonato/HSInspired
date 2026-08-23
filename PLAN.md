# Card Effects Plan

Status: proposed implementation direction.

This plan defines how card data in `src/game/content/cards/sets/*.json` should
gain machine-readable effects while remaining easy for a person to author and
review. It is intentionally a design and implementation plan; adding the data
and engine support happens in later implementation steps.

## 1. Goal

Give every card an explicit `effects` array that describes gameplay behavior,
without parsing `rulesText` and without putting executable code in JSON.

The desired starting point is deliberately simple:

```json
"rulesText": "",
"effects": []
```

The empty array means that the card has no executable behavior beyond its base
stats and metadata. Vanilla minions and token cards should use this form.

The final system must support the existing Basic, Classic, Goblins vs Gnomes,
and Naxxramas corpus, including Battlecries, Deathrattles, Secrets, auras,
random effects, conditional effects, choices, temporary modifiers, and token
summons.

## 2. Why this direction

The current card model stores only display text for card rules. `CardDefinition`
has `rulesText`, but no machine-readable effect field. The validator and catalog
therefore cannot validate or execute mechanics independently of prose.

The card corpus is already large and varied:

- 613 cards are loaded from the four card sets.
- 67 cards have empty rules text because they are vanilla cards or tokens.
- Approximately 107 cards use Battlecry.
- Approximately 41 cards use Deathrattle.
- Approximately 47 cards use `Whenever` triggers.
- Approximately 24 cards use Secrets.
- Approximately 58 cards use random selection or random outcomes.

The text itself is not a safe programming language. It contains inconsistent
punctuation and capitalization, display-specific wording, and rules that need
context such as "if that kills it" or "randomly split". Parsing it would make
the renderer, validator, and game engine depend on fragile natural-language
interpretation.

The system should therefore keep two deliberately separate representations:

```text
rulesText -> player-facing card wording
effects   -> typed, validated, executable game rules
```

This follows the existing domain boundary: the rules belong in `src/game`,
the renderer displays `rulesText`, and the renderer receives gameplay results
through domain events rather than interpreting card JSON.

## 3. Decisions to lock in

1. Every card record has a required `effects` array. It is never omitted or
   `null`.
2. `rulesText` remains required display copy and is never parsed as code.
3. Effects are declarative data. No JavaScript, formulas, callbacks, or
   arbitrary mini-scripts are stored in JSON.
4. The primary shape is an ordered list of trigger blocks.
5. Each trigger block contains an ordered list of typed actions.
6. Static keywords such as Taunt and Charge are represented inside `effects`,
   so `effects: []` has one consistent meaning.
7. Conditions, choices, and repeats are the only nested composition constructs
   initially allowed.
8. Card references use existing `cardId` values. Summon effects must not
   duplicate token attack and health values.
9. Randomness is resolved by the deterministic game RNG, never by the renderer
   or by an effect definition itself.
10. Effect definitions contain game behavior only. They do not contain PixiJS
    assets, animation names, UI coordinates, or presentation instructions.

## 4. Approaches considered

### Approach A: Named recipes or effect IDs

```json
"effects": [
  "taunt",
  "battlecry.destroy-opponent-weapon"
]
```

This is compact and makes reusable keywords easy. It becomes difficult when a
card needs parameters, targets, conditions, or multiple ordered actions. The
real behavior moves into an external catalog, so a reader cannot understand a
card by reading its JSON alone. It also creates an ever-growing collection of
special-case recipe IDs.

**Decision:** do not use effect IDs as the primary format. They may be useful as
internal aliases for genuinely reusable implementation details later.

### Approach B: Flat atomic effect records

```json
"effects": [
  {
    "trigger": "battlecry",
    "action": "destroy",
    "target": "opponent.weapon"
  },
  {
    "trigger": "deathrattle",
    "action": "damage",
    "target": "all.characters",
    "amount": 2
  }
]
```

This is concise and easy to validate. It works well for simple damage, draw,
buff, summon, and destroy cards. However, repeated trigger fields become noisy,
and conditional branches, Secret event filters, and multi-step effects become
harder to read.

**Decision:** retain the flat action idea, but group actions by trigger.

### Approach C: Trigger blocks with constrained composition

```json
"effects": [
  {
    "trigger": "deathrattle",
    "actions": [
      {
        "action": "damage",
        "target": "all.characters",
        "amount": 2
      }
    ]
  }
]
```

This makes lifecycle, ordering, and multi-action behavior explicit. It also
gives the engine a natural unit to register for a trigger. The risk is allowing
the format to become a general-purpose programming language.

**Decision:** use this as the foundation, with a small closed action and
condition vocabulary. Do not implement an arbitrary recursive AST.

## 5. Recommended data layout

Add `effects` immediately after `rulesText` in each JSON record. Preserve the
existing field order for the other properties.

### 5.1 Effect block

Conceptually:

```ts
interface CardEffectBlock {
  readonly trigger: CardTrigger
  readonly actions: readonly CardAction[]
  readonly event?: EventFilter
  readonly condition?: CardCondition
}
```

Initial trigger values should include:

```text
static
cast
battlecry
deathrattle
start-of-turn
end-of-turn
on-summon
on-cast
on-damage
on-heal
on-attack
on-death
secret
while-in-hand
```

`static` means the action is active while the source entity is in its relevant
zone. It handles intrinsic keywords and auras. `secret` represents a persistent
event listener and uses `event` to describe what reveals it.

### 5.2 Action vocabulary

The first implementation should support these action families:

```text
keyword
damage
restore
draw
discard
summon
destroy
silence
freeze
transform
modify
return-to-hand
take-control
equip
gain-armor
gain-mana
change-cost
counter-event
if
choose
repeat
```

The validator should reject unknown action names. When a new mechanic is
needed, add a new typed action variant and its executor rather than adding a
free-form escape hatch.

### 5.3 Targets and selections

Common targets should use a small, documented union of semantic references:

```text
self
self.hero
opponent.hero
selected.minion
selected.character
opponent.weapon
friendly.minions
enemy.minions
all.minions
all.characters
```

The strings above are identifiers from a closed vocabulary, not arbitrary paths.
Selection and filtering are separate fields when needed:

```json
{
  "action": "destroy",
  "target": "enemy.minion",
  "selection": "random",
  "filter": {
    "stat": "attack",
    "operator": "lte",
    "value": 2
  }
}
```

The engine, not the card JSON, resolves runtime instance IDs and validates
whether a target is legal.

### 5.4 Values and durations

Literal numbers should cover the common case:

```json
{
  "action": "damage",
  "target": "selected.minion",
  "amount": 4
}
```

Dynamic values should use typed references, not formula strings. Examples of
future typed values include `source.attack`, `event.damage`, or a count of
matching entities. Temporary effects use a closed duration vocabulary such as:

```text
this-turn
next-turn
permanent
while-source-in-play
while-damaged
```

## 6. Distinct card examples

### 6.1 Vanilla minion

```json
{
  "id": "basic_bloodfen_raptor",
  "name": "Bloodfen Raptor",
  "type": "Minion",
  "attack": 3,
  "health": 2,
  "rulesText": "",
  "effects": []
}
```

### 6.2 Static keyword

```json
{
  "rulesText": "Charge",
  "effects": [
    {
      "trigger": "static",
      "actions": [
        {
          "action": "keyword",
          "keyword": "charge",
          "target": "self"
        }
      ]
    }
  ]
}
```

### 6.3 Battlecry with one action

```json
{
  "rulesText": "Battlecry: Destroy your opponent's weapon.",
  "effects": [
    {
      "trigger": "battlecry",
      "actions": [
        {
          "action": "destroy",
          "target": "opponent.weapon"
        }
      ]
    }
  ]
}
```

### 6.4 Multiple trigger blocks

```json
{
  "rulesText": "Taunt. Deathrattle: deal 2 damage to all characters",
  "effects": [
    {
      "trigger": "static",
      "actions": [
        {
          "action": "keyword",
          "keyword": "taunt",
          "target": "self"
        }
      ]
    },
    {
      "trigger": "deathrattle",
      "actions": [
        {
          "action": "damage",
          "target": "all.characters",
          "amount": 2
        }
      ]
    }
  ]
}
```

### 6.5 Randomly split damage

```json
{
  "rulesText": "Deal 3 damage randomly split among enemy characters.",
  "effects": [
    {
      "trigger": "cast",
      "actions": [
        {
          "action": "damage",
          "target": "enemy.character",
          "selection": "random",
          "count": 3,
          "amount": 1
        }
      ]
    }
  ]
}
```

Three random one-damage hits are explicit, so this cannot be confused with
three damage to every enemy character.

### 6.6 Conditional follow-up

```json
{
  "rulesText": "Deal 1 damage to a minion. If that kills it, draw a card.",
  "effects": [
    {
      "trigger": "cast",
      "actions": [
        {
          "action": "damage",
          "target": "selected.minion",
          "amount": 1
        },
        {
          "action": "if",
          "condition": {
            "type": "target-died"
          },
          "then": [
            {
              "action": "draw",
              "player": "self",
              "count": 1
            }
          ]
        }
      ]
    }
  ]
}
```

### 6.7 Choose One

```json
{
  "rulesText": "Choose One - Draw 2 cards; or Restore 5 Health.",
  "effects": [
    {
      "trigger": "battlecry",
      "actions": [
        {
          "action": "choose",
          "options": [
            [
              {
                "action": "draw",
                "player": "self",
                "count": 2
              }
            ],
            [
              {
                "action": "restore",
                "target": "self.hero",
                "amount": 5
              }
            ]
          ]
        }
      ]
    }
  ]
}
```

### 6.8 Summoning an existing token

```json
{
  "rulesText": "Deathrattle: Summon a 4/4 Nerubian.",
  "effects": [
    {
      "trigger": "deathrattle",
      "actions": [
        {
          "action": "summon",
          "cardId": "naxxramas_nerubian",
          "count": 1
        }
      ]
    }
  ]
}
```

The summoned card owns its stats and keywords. The effect only references its
`cardId`, preventing duplicated or inconsistent token data.

### 6.9 Static aura

```json
{
  "rulesText": "Your other Beasts have +1 Attack.",
  "effects": [
    {
      "trigger": "static",
      "actions": [
        {
          "action": "modify",
          "target": "friendly.other.minions",
          "filter": {
            "subtype": "Beast"
          },
          "attack": 1,
          "duration": "while-source-in-play"
        }
      ]
    }
  ]
}
```

## 7. Content migration

### Phase 1: Establish the contract

- Add `effects: []` to every card record in `basic.json`, `classic.json`,
  `goblins-vs-gnomes.json`, and `naxxramas.json`.
- Include collectible cards, uncollectible cards, and tokens.
- Decide explicitly how the Hero Power record in `classic.json` is handled. The
  preferred direction is to reuse the same effect types in the separate hero
  power catalog, because Hero Powers are also gameplay rules.
- Add `effects` to the typed card metadata and raw validation record.
- Require an array and reject malformed effect blocks.

At this stage, the data shape changes but gameplay behavior does not yet change.
Do not pretend that a non-empty `rulesText` is implemented merely because the
card has an empty effects array during this transition.

### Phase 2: Add validation and catalog checks

- Validate trigger names and action names.
- Validate target references, selection modes, numbers, durations, conditions,
  and choice structure.
- Validate every referenced `cardId` against the complete catalog after all card
  sets are assembled.
- Add a coverage report/test showing which cards have non-empty `rulesText` but
  no non-empty `effects` yet.

Once implementation coverage is complete, that report should become a failing
test rather than informational output.

### Phase 3: Implement the domain effect resolver

The current match model handles opening flow and basic minion play. Effects need
to remain in `src/game` and should be introduced through a deterministic reducer
or resolver with an event queue.

The engine will eventually need to represent:

- current and maximum health;
- base stats and temporary/permanent modifiers;
- keywords and silence state;
- weapons and durability;
- Secrets and persistent triggers;
- card costs modified in hand or play;
- source entity and event context;
- target and choice requests;
- deterministic random selection;
- death and Deathrattle ordering.

Actions should emit domain events such as damage dealt, health restored, card
drawn, card discarded, minion summoned, keyword applied, and effect resolved.
The renderer consumes those events for animation. It must not execute effects or
import effect implementation code.

### Phase 4: Populate mechanics incrementally

Implement and populate in this order:

1. Static keywords and basic cast actions.
2. Damage, restore, draw, discard, destroy, and summon.
3. Buffs, debuffs, temporary durations, armor, mana, and cost changes.
4. Battlecries and target selection.
5. Deathrattles and death resolution.
6. Start/end-turn and `Whenever` triggers.
7. Secrets and event filters.
8. Random pools, choices, transforms, copies, and advanced interactions.

Populate Basic first, then Classic, then Goblins vs Gnomes and Naxxramas. Each
mechanic family should gain domain tests before its card data is populated at
scale.

## 8. Code ownership and likely files

### Domain/content

- `src/game/content/cards/card-effects.ts` — effect types, targets, actions,
  conditions, and value references.
- `src/game/content/cards/card-definition.ts` — add readonly `effects` to card
  metadata.
- `src/game/content/cards/card-validator.ts` — validate and normalize effects.
- `src/game/content/cards/card-catalog.ts` — preserve effects and validate
  cross-card references.
- `src/game/content/hero-powers/` — reuse effect definitions for Hero Powers
  when they are moved into the same executable model.

### Match engine

- `src/game/match/` — effect resolution, state changes, commands, trigger
  ordering, deterministic RNG, and domain events.
- Colocated tests beside every new domain module.

### Renderer

- `src/renderer/features/game/` — present domain events, request targets and
  choices, and animate changes.
- `src/renderer/rendering/cards/` — continue rendering `rulesText`; do not
  interpret `effects`.
- `src/renderer/features/collection/` — keep human-facing search based on card
  names, rules text, rarity, and optionally derived keyword labels. Do not expose
  raw JSON effect syntax as the normal search text.

## 9. Tests and verification

Add tests for:

- every card having an effects array;
- vanilla cards preserving `effects: []`;
- malformed triggers, actions, targets, filters, and card references;
- representative static, cast, Battlecry, Deathrattle, Secret, aura, random,
  conditional, choice, and summon effects;
- deterministic random outcomes with the seeded RNG;
- action ordering and trigger ordering;
- target legality and invalid choices;
- temporary modifier expiration;
- cross-set token references;
- renderer behavior remaining based on `rulesText` and domain events.

Before implementation handoff, run the repository's canonical verification:

```bash
npm run verify
```

This must include formatting, lint, type checking, dependency boundaries,
content validation, unit tests, and the build smoke test.

## 10. Completion criteria

The effects work is complete when:

- every card record has a validated `effects` array;
- `rulesText` is still display-only and no parser exists;
- all populated effects use the closed typed vocabulary;
- every non-vanilla rules text has corresponding executable effect data;
- token and cross-set references validate;
- the match engine resolves effects deterministically and emits presentation
  events;
- the renderer does not contain card-rule execution logic;
- representative cards from every set pass domain and content tests;
- `npm run verify` passes.
