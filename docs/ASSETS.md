# Runtime assets and layout

Runtime images live under `assets/images` by semantic use: `cards`, `card-artwork`, `cursor`,
`game`, `heroes`, and `ui`. Generic filenames use lowercase kebab-case. Card artwork is the
exception: its basename is the exact `CardId`, so a catalog entry such as
`classic_abomination` resolves to `classic_abomination.jpg`.

Runtime audio lives under `assets/audio` and also uses lowercase kebab-case. The injected
`AudioService` imports only approved cues, preloads them once, and keeps failed optional cues
non-fatal.

Editable PSDs and source material live in `assets/source`; pending artwork is in
`assets/images/card-artwork-to-do`; old card assets are in `assets/card-assets-archive`.
`electron-builder.yml` excludes the source `assets/**` tree; Vite-emitted runtime assets under
`out/renderer/assets` are packaged instead.

`src/renderer/src/ui/asset-registry` is the canonical source for bespoke semantic assets. Each
entry declares a stable key, imported source, authored dimensions, owner, and bundle. The same
definitions create the Pixi manifest and bundle registration. Card artwork uses an ID-backed
convention because it is a homogeneous family. Consumers request semantic keys through the
registry/resolver, leaving standalone images and future atlas frames interchangeable.

Feature-local layout declares rendered positions, dimensions, text, and z-order beside the
component. Full renderer scenes use 1920 x 1080 coordinates; complete cards use 620 x 900.
