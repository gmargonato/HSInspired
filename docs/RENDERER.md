# Renderer ownership

`src/renderer/src/app` is the composition root. It creates `AppServices`, defines typed
`AppRoute` values, and maps routes to concrete scenes. `SceneManager` owns Pixi application
integration, scene stack lifecycle, and transitions. `Scene` provides the shared lifecycle
contract and receives only a narrow manager port.

Scenes coordinate loading, navigation, and feature lifecycle. Collection query/filter state,
paging, card-grid placement, deck-list/editor models, search DOM adaptation, reveal choreography,
and detail-panel construction are feature-owned modules. The deck-builder view can be mounted as
a nested feature view or wrapped by the route adapter `NewDeckScene`; it does not construct scenes
itself.

Production card rendering is under `rendering/cards`. `CardView` is read-only and consumes
validated domain content plus `CardAssetResolver`. The development Card Inspector composes
that same production renderer from `features/dev` and is reached only through the development
startup flag described in the root README.

Scene geometry (positions, sizes, anchors, scales, and reference frames) is described in
[docs/LAYOUT.md](LAYOUT.md). Each scene keeps its layout in a `*-layout.ts` module next to the
feature that owns it, and a development-only overlay (toggle with **F2**) annotates every
labelled Pixi object live.
