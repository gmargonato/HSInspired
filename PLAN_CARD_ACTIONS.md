# Card Effects Plan

## 1. Goal

Give every card a machine-readable gameplay definition without parsing `rulesText` and without storing executable code in JSON.

The system should distinguish between:

- what a card **is**;
- what intrinsic properties it has;
- when an effect triggers;
- whether an effect is allowed to resolve;
- what game-state change occurs;
- which game entities the change applies to.

The card JSON should remain readable enough that a developer can understand most cards directly from the file.

The core rule is:

> Properties describe what an entity is. Triggers describe when something happens. Conditions describe whether it applies. Actions describe what the game does. Selectors describe who or what it happens to.

---

## 2. Core design principles

1. `rulesText` remains player-facing display text only.
2. The game engine never parses `rulesText`.
3. Card behavior is represented as typed, validated declarative data.
4. JSON must not contain JavaScript, callbacks, formulas, or arbitrary scripts.
5. Intrinsic card characteristics should not be modeled as executable effects.
6. Triggered behavior should use explicit trigger blocks.
7. Actions should represent actual game-state changes.
8. Targets should use structured selectors rather than compound dotted strings.
9. Conditions and choices should remain constrained and typed.
10. Randomness is always resolved by the deterministic game RNG.
11. The renderer consumes domain events and never executes card rules.
12. The schema should optimize for the real Hearthstone card corpus rather than maximum theoretical uniformity.

---

## 3. Card model

A card definition should conceptually contain three gameplay layers:

```text
Card
├── base properties
├── intrinsic properties
└── triggered effects
```

Example:

```json
{
  "id": "basic_bluegill_warrior",
  "name": "Bluegill Warrior",
  "type": "Minion",
  "cost": 2,
  "attack": 2,
  "health": 1,
  "rulesText": "Charge",
  "keywords": ["charge"],
  "effects": []
}
```

`keywords` describes intrinsic properties of the card.

`effects` describes behavior that must be resolved by the game engine.

This avoids representing a naturally occurring keyword as:

```text
static
  -> keyword action
    -> charge
      -> self
```

when the simpler and more accurate statement is:

```text
this card has Charge
```

---

## 4. Intrinsic properties

### 4.1 Keywords

Static keywords naturally owned by the card should live outside the effect system.

Example:

```json
{
  "keywords": ["taunt", "divine-shield"],
  "effects": []
}
```

Initial keyword values may include:

```text
taunt
charge
divine-shield
stealth
windfury
spell-damage
immune
```

The exact list should grow only when required by supported cards.

### 4.2 Why keywords are not effects

A minion naturally possessing Taunt or Charge is not performing an action against itself.

These are properties consulted by game rules.

However, granting a keyword to another entity is an action.

Example:

```json
{
  "action": "grant-keyword",
  "keyword": "taunt",
  "target": {
    "controller": "self",
    "type": "minion",
    "selection": "chosen"
  }
}
```

The distinction is:

```text
Intrinsic keyword:
card has Taunt

Effect:
give another minion Taunt
```

---

## 5. Effects

Triggered gameplay behavior remains represented as an ordered list of effect blocks.

Conceptually:

```ts
interface CardEffectBlock {
  readonly trigger: CardTrigger
  readonly condition?: CardCondition
  readonly event?: EventFilter
  readonly actions: readonly CardAction[]
}
```

Example:

```json
{
  "trigger": "battlecry",
  "actions": [
    {
      "action": "destroy",
      "target": {
        "controller": "opponent",
        "type": "weapon"
      }
    }
  ]
}
```

Trigger blocks remain useful because they:

- make lifecycle behavior explicit;
- preserve action ordering;
- allow multiple actions under one trigger;
- allow one card to contain several independent triggers;
- give the engine a natural registration and resolution boundary.

---

## 6. Trigger vocabulary

Initial trigger values should include:

```text
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

Avoid a generic `static` trigger for intrinsic keywords.

A persistent aura may still need a lifecycle-aware representation, but it should be modeled explicitly as an aura/modifier rather than using `static` as a catch-all bucket for unrelated mechanics.

Example future aura effect:

```json
{
  "trigger": "aura",
  "actions": [
    {
      "action": "modify",
      "target": {
        "controller": "self",
        "type": "minion",
        "exclude": "source"
      },
      "attack": 1,
      "health": 1,
      "duration": "while-source-in-play"
    }
  ]
}
```

If `aura` proves unnecessary as a trigger, the runtime may instead register persistent modifiers directly from a dedicated aura definition. The important point is that intrinsic keywords and board-wide modifiers should not be forced into the same representation.

---

## 7. Actions

Actions describe actual game-state changes.

Initial action families should include:

```text
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
grant-keyword
remove-keyword
return-to-hand
take-control
equip
gain-armor
gain-mana
change-cost
counter-event
```

The validator should reject unknown actions.

When a new mechanic is needed, add a typed action variant and executor rather than introducing a free-form escape hatch.

### 7.1 Actions should remain verbs

The action system should not become the container for every game concept.

The following should not automatically be treated as normal actions:

```text
if
choose
repeat
```

These are control/composition constructs.

They may still exist in the schema, but should be modeled distinctly from game-state-changing actions.

Conceptually:

```text
Effect
├── trigger
├── condition
└── resolution
    ├── actions
    ├── branch
    ├── choice
    └── repeat
```

This keeps the design from gradually becoming an arbitrary programming language disguised as JSON.

---

## 8. Structured target selectors

Do not encode targeting semantics into dotted strings such as:

```text
opponent.weapon
friendly.other.minions
selected.character
enemy.minion
```

Even when these values come from a closed vocabulary, they combine several independent concepts into one identifier.

That becomes difficult to extend.

Instead, use a structured selector.

### 8.1 Basic selector

Example:

```json
{
  "controller": "opponent",
  "type": "weapon"
}
```

Example:

```json
{
  "controller": "self",
  "type": "minion",
  "exclude": "source"
}
```

Example:

```json
{
  "controller": "opponent",
  "type": "character"
}
```

### 8.2 Suggested selector fields

The initial selector model may support:

```text
controller
type
selection
exclude
filter
zone
```

Possible values:

```text
controller:
  self
  opponent
  any

type:
  hero
  minion
  character
  weapon
  card

selection:
  chosen
  random
  all
  source
  event-source
  event-target

exclude:
  source
```

Do not add fields until an actual card requires them.

### 8.3 Filters

Filters refine the candidate set.

Example:

```json
{
  "action": "destroy",
  "target": {
    "controller": "opponent",
    "type": "minion",
    "selection": "random",
    "filter": {
      "stat": "attack",
      "operator": "lte",
      "value": 2
    }
  }
}
```

Possible future filters may include:

```text
tribe
damaged
frozen
attack
health
cost
keyword
card-type
```

Filters should remain typed.

Do not introduce arbitrary expression strings.

---

## 9. Selection belongs with targeting

Selection is part of determining which entity or entities an action applies to.

Prefer:

```json
{
  "target": {
    "controller": "opponent",
    "type": "character",
    "selection": "random"
  }
}
```

over splitting logically related target information across unrelated top-level fields.

For repeated random hits:

```json
{
  "action": "damage",
  "target": {
    "controller": "opponent",
    "type": "character",
    "selection": "random"
  },
  "hits": 3,
  "amount": 1
}
```

The engine performs three independent one-damage selections using the deterministic RNG.

---

## 10. Conditions

Conditions determine whether an effect or branch resolves.

They are not actions.

Example:

```json
{
  "trigger": "battlecry",
  "condition": {
    "type": "player-has-weapon",
    "player": "opponent"
  },
  "actions": [
    {
      "action": "destroy",
      "target": {
        "controller": "opponent",
        "type": "weapon"
      }
    }
  ]
}
```

Conditions should use a small closed typed vocabulary.

Possible initial condition families:

```text
target-died
target-survived
player-has-weapon
player-has-minion
source-damaged
target-damaged
hand-not-empty
board-not-full
```

Only add conditions required by actual cards.

---

## 11. Branches and choices

Some Hearthstone effects require flow control.

These should remain constrained composition constructs rather than arbitrary recursive scripts.

### 11.1 Conditional follow-up

Example:

```json
{
  "trigger": "cast",
  "actions": [
    {
      "action": "damage",
      "target": {
        "type": "minion",
        "selection": "chosen"
      },
      "amount": 1
    }
  ],
  "then": {
    "condition": {
      "type": "target-died"
    },
    "actions": [
      {
        "action": "draw",
        "player": "self",
        "count": 1
      }
    ]
  }
}
```

The exact shape may be adjusted during implementation, but branching should remain structurally distinct from actions.

### 11.2 Choices

Example:

```json
{
  "trigger": "battlecry",
  "choice": {
    "options": [
      {
        "actions": [
          {
            "action": "draw",
            "player": "self",
            "count": 2
          }
        ]
      },
      {
        "actions": [
          {
            "action": "restore",
            "target": {
              "controller": "self",
              "type": "hero"
            },
            "amount": 5
          }
        ]
      }
    ]
  }
}
```

The game engine owns choice resolution.

The renderer only presents the options and returns the player's selection.

---

## 12. Values and durations

Literal values should cover the normal case.

Example:

```json
{
  "action": "damage",
  "target": {
    "type": "minion",
    "selection": "chosen"
  },
  "amount": 4
}
```

Dynamic values should use typed references rather than formula strings.

Possible future references:

```text
source.attack
source.health
event.damage
event.amount
target.attack
matching-entity-count
```

Temporary modifiers should use a closed duration vocabulary such as:

```text
this-turn
next-turn
permanent
while-source-in-play
while-damaged
```

---

## 13. Representative card examples

### 13.1 Vanilla minion

```json
{
  "id": "basic_bloodfen_raptor",
  "name": "Bloodfen Raptor",
  "type": "Minion",
  "cost": 2,
  "attack": 3,
  "health": 2,
  "rulesText": "",
  "keywords": [],
  "effects": []
}
```

### 13.2 Intrinsic keyword

```json
{
  "id": "basic_bluegill_warrior",
  "name": "Bluegill Warrior",
  "type": "Minion",
  "cost": 2,
  "attack": 2,
  "health": 1,
  "rulesText": "Charge",
  "keywords": ["charge"],
  "effects": []
}
```

### 13.3 Battlecry

```json
{
  "id": "basic_acidic_swamp_ooze",
  "name": "Acidic Swamp Ooze",
  "type": "Minion",
  "cost": 2,
  "attack": 3,
  "health": 2,
  "rulesText": "Battlecry: Destroy your opponent's weapon.",
  "keywords": [],
  "effects": [
    {
      "trigger": "battlecry",
      "actions": [
        {
          "action": "destroy",
          "target": {
            "controller": "opponent",
            "type": "weapon"
          }
        }
      ]
    }
  ]
}
```

### 13.4 Randomly split damage

```json
{
  "id": "basic_arcane_missiles",
  "name": "Arcane Missiles",
  "type": "Spell",
  "cost": 1,
  "rulesText": "Deal 3 damage randomly split among enemy characters.",
  "keywords": [],
  "effects": [
    {
      "trigger": "cast",
      "actions": [
        {
          "action": "damage",
          "target": {
            "controller": "opponent",
            "type": "character",
            "selection": "random"
          },
          "hits": 3,
          "amount": 1
        }
      ]
    }
  ]
}
```

### 13.5 Aura

```json
{
  "id": "basic_stormwind_champion",
  "name": "Stormwind Champion",
  "type": "Minion",
  "cost": 7,
  "attack": 6,
  "health": 6,
  "rulesText": "Your other minions have +1/+1.",
  "keywords": [],
  "effects": [
    {
      "trigger": "aura",
      "actions": [
        {
          "action": "modify",
          "target": {
            "controller": "self",
            "type": "minion",
            "exclude": "source"
          },
          "attack": 1,
          "health": 1,
          "duration": "while-source-in-play"
        }
      ]
    }
  ]
}
```

### 13.6 Deathrattle summon

```json
{
  "rulesText": "Deathrattle: Summon a 4/4 Nerubian.",
  "keywords": [],
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

The summoned card owns its own stats, keywords, and effects.

The summoning effect should reference only its `cardId`.

---

## 14. What should not be encoded in card JSON

Do not store:

- JavaScript;
- callbacks;
- arbitrary expressions;
- renderer animation names;
- PixiJS assets;
- screen coordinates;
- runtime entity IDs;
- application service names;
- engine implementation class names;
- SQL-like or path-like target expressions;
- natural-language conditions that the engine must parse.

Card JSON describes game rules, not implementation details.

---

## 15. Engine responsibilities

The match engine resolves the declarative definitions.

It must own:

- legal target discovery;
- target selection;
- deterministic randomness;
- current and maximum health;
- base stats and modifiers;
- intrinsic and granted keywords;
- silence state;
- weapon state and durability;
- Secrets;
- persistent triggers;
- cost changes;
- source context;
- event context;
- target requests;
- player choices;
- death processing;
- Deathrattle ordering;
- aura registration and removal.

Actions should emit domain events such as:

```text
damage-dealt
health-restored
card-drawn
card-discarded
minion-summoned
minion-destroyed
keyword-granted
keyword-removed
modifier-applied
effect-resolved
```

The renderer consumes these events for presentation.

---

## 16. Data ownership

### Card definition

Owns:

```text
base stats
metadata
rulesText
intrinsic keywords
effect definitions
```

### Runtime entity

Owns:

```text
current stats
damage
temporary modifiers
granted keywords
removed keywords
silence state
runtime identity
controller
zone
```

This distinction is important.

A card definition says:

```text
Bluegill Warrior has Charge.
```

A runtime entity may later say:

```text
Bluegill Warrior is silenced.
```

The original card definition must remain immutable.

---

## 17. Validation

Validation should happen at two levels.

### 17.1 Schema validation

Validate:

- `keywords` is always an array;
- `effects` is always an array;
- keyword names are known;
- triggers are known;
- action variants are known;
- required action fields exist;
- selector fields are legal;
- filters are legal;
- durations are legal;
- conditions are legal;
- branch structures are legal;
- choice structures are legal.

### 17.2 Catalog validation

After all card sets are loaded:

- validate every referenced `cardId`;
- validate tokens and uncollectible cards;
- validate cross-set references;
- report cards with non-empty `rulesText` but no implemented gameplay representation;
- ensure unsupported mechanics fail explicitly.

No invalid definition should silently fall back to `rulesText`.

---

## 18. Migration strategy

### Phase 1: Establish the card contract

Add:

```json
"keywords": [],
"effects": []
```

to every card record.

Update:

```text
CardDefinition
raw validation schema
catalog normalization
tests
```

Do not change gameplay behavior yet.

### Phase 2: Implement intrinsic keywords

Populate straightforward static keywords first.

Examples:

```text
Taunt
Charge
Divine Shield
Stealth
Windfury
```

Implement runtime keyword handling separately from the effect resolver.

### Phase 3: Implement basic actions

Implement:

```text
damage
restore
draw
discard
destroy
summon
gain-armor
gain-mana
equip
```

Add domain tests before mass-populating cards.

### Phase 4: Implement targeting

Implement structured selectors.

Start with:

```text
controller
type
selection
exclude
```

Then add typed filters only when required.

### Phase 5: Implement Battlecries and cast effects

Support:

```text
cast
battlecry
target requests
ordered action resolution
```

Populate Basic before moving to Classic.

### Phase 6: Implement Deathrattles and death processing

Add:

```text
death detection
death queue
Deathrattle ordering
summon-after-death
source/event context
```

### Phase 7: Implement persistent effects

Add:

```text
auras
turn triggers
Whenever triggers
Secrets
cost modifiers
persistent listeners
```

### Phase 8: Implement advanced composition

Add only when required:

```text
conditions
branches
choices
repeats
dynamic values
random pools
copies
transforms
```

Do not build advanced composition speculatively.

---

## 19. Recommended implementation order by set

Populate mechanics in this order:

1. Basic
2. Classic
3. Naxxramas
4. Goblins vs Gnomes

Within each set:

1. vanilla cards;
2. intrinsic keywords;
3. simple one-action effects;
4. targeted effects;
5. Battlecries;
6. Deathrattles;
7. auras and persistent triggers;
8. random effects;
9. conditional effects;
10. Secrets and unusual mechanics.

Each mechanic family should gain tests before large-scale content migration.

---

## 20. Suggested files

### Domain/content

```text
src/game/content/cards/card-definition.ts
src/game/content/cards/card-keywords.ts
src/game/content/cards/card-effects.ts
src/game/content/cards/card-targets.ts
src/game/content/cards/card-conditions.ts
src/game/content/cards/card-validator.ts
src/game/content/cards/card-catalog.ts
```

### Match engine

```text
src/game/match/effects/
src/game/match/targeting/
src/game/match/events/
src/game/match/modifiers/
src/game/match/triggers/
```

Exact module structure may change as implementation reveals natural boundaries.

Prefer small domain modules over one large generic effect engine.

### Renderer

```text
src/renderer/features/game/
src/renderer/rendering/cards/
src/renderer/features/collection/
```

The renderer:

- displays `rulesText`;
- displays keyword information;
- requests player target/choice input;
- consumes domain events;
- animates results.

It does not execute rules.

---

## 21. Tests

Add tests for:

- every card having `keywords`;
- every card having `effects`;
- vanilla cards using empty arrays;
- intrinsic keyword behavior;
- granted keyword behavior;
- silence interactions;
- malformed triggers;
- malformed actions;
- malformed selectors;
- malformed filters;
- malformed conditions;
- invalid referenced card IDs;
- deterministic random selection;
- repeated random hits;
- legal and illegal targets;
- action ordering;
- trigger ordering;
- Battlecry resolution;
- Deathrattle resolution;
- aura application and removal;
- temporary modifier expiration;
- choices;
- Secrets;
- cross-set token references;
- renderer independence from game-rule execution.

Run the repository's canonical verification:

```bash
npm run verify
```

This should include formatting, linting, type checking, dependency validation, content validation, unit tests, and build verification.

---

## 22. Completion criteria

The effects system is complete when:

- every card has `keywords` and `effects`;
- `rulesText` remains display-only;
- intrinsic keywords are not represented as self-targeted actions;
- triggered behavior uses typed effect blocks;
- actions represent game-state-changing verbs;
- targets use structured selectors;
- conditions are separate from actions;
- choices and branches remain constrained;
- no arbitrary mini-language exists in JSON;
- all card references validate;
- randomness is deterministic;
- the renderer never executes game rules;
- representative cards from every supported set pass domain tests;
- every non-vanilla gameplay rule has a machine-readable implementation;
- `npm run verify` passes.

---

## 23. Design constraint for future mechanics

When a new card cannot be represented cleanly, do not immediately generalize the entire schema.

First ask:

1. Is this an intrinsic property?
2. Is this a trigger?
3. Is this a condition?
4. Is this an action?
5. Is this a target-selection problem?
6. Is this a genuinely new game mechanic?

Prefer adding one explicit typed concept over introducing a general expression language.

The schema should remain boring, predictable, and easy to inspect.

That is a feature.
