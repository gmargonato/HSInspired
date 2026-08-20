# Content model

Authored cards remain JSON in `src/game/content/cards/sets`. The four runtime registrations
are Basic, Classic, Goblins vs Gnomes, and Naxxramas. Each registration imports its JSON and
passes it through `validateCardSet`; malformed content fails with a path-specific
`ContentValidationError`.

`CardDefinition` is a discriminated union. Minions require attack and health, weapons require
attack and durability, heroes require armor, and spells reject those fields. Every card has a
branded `CardId`, `ClassId`, `ExpansionId`, explicit `rulesText`, and collectible/deck-legality
metadata. Hero Powers are validated as their own records and live in the hero-power catalog,
not the card catalog.

The same catalog construction path is used at runtime and by `npm run content:check`. Content
may identify future mechanics by stable IDs, but English rules text is display data and is not
an execution language.
