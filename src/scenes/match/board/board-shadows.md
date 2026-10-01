# Match shadows

Edit `match-shadow-config.ts` and reload the match:

- `enabled`: turn all match shadows on/off.
- `depth`: shadow separation multiplier (1 = normal, 0 = hidden).
- `responseMs`: elevation response time; smaller is faster, 0 is immediate.
- `opacity` and `lightOffset`: darkness and light direction.
- `groundOpacityBoost`: extra darkness near the board, fading away as objects lift.
- `draggedCardDepth`: separation multiplier while holding a hand card (default 5).
  Releasing the card restores normal depth through the existing smoothing.
- `blur`: softness baked into the shared shapes (default 3; 0 gives hard edges).
  The default light comes from the upper right, casting shadows down and left.

Relative scale normally supplies elevation. Hand inspection zoom is capped at
held-card height, and shared combat/draw presenters supply a minimum lift when
motion alone does not change scale. These controls do not alter game animations.

Existing heroes, minions, weapons, powers, card slots, and opponent card backs
inherit shadows automatically. For a **new kind of physical visual**, call
`attachShadow` once in its reusable constructor with its local body bounds;
rounded rectangle is the default shape. Set `restingScale` from its layout before
entrance animation. Do not attach shadows to labels, particle effects, or glows.
No per-instance registration with the match or destruction hook is needed.

The registry contains physical roots only and releases them on destruction. The
match samples only visible casters belonging to its gameplay root; it never scans
their artwork children or measures live bounds each frame. Each shadow layer lazily
bakes two shared primitive textures, with blur and transparent edge padding.
Heroes and board minions instead supply offstage physical silhouettes. Heroes
include the portrait frame and visible stat badges; minions include the filled
portrait, frame, Taunt, legendary decoration, Frozen ice, stat badges and solid
ability markers. Magical overlays, numbers, sleeping Zs, glows and pulses are
excluded.
Each visible hero and minion caches its own texture (256 pixels along the longest
body dimension, plus blur padding). Bounds measurement and baking happen only on
first use or a silhouette revision, such as toggling Taunt or changing frames.
Movement and stat-number changes reuse the texture. Replaced textures are destroyed;
hidden/removed pieces release their caches on the next shadow update.
Ordinary shadows use sprites; perspective cards use a small 10x10 mesh sharing
the shared primitive textures. There are no live blur filters,
continuous offscreen passes, or extra tickers. Scene update drives the layer, so
pausing and unloading follow the game. Textures are released with their layer.

Discover, Tracking, Choose One, and hero-power choices also cast shadows. The
shared choice overlay has a shadow layer above its dimmer and below its cards, so
these shadows stay visible. Its cards are excluded from the board's shadow layer
to prevent duplicates; a card moved into the hand automatically switches layers.

Card presentation helpers switch the descriptor's visible body while a temporary
mesh replaces the original. They preserve smoothed elevation and exclude snapshot
padding. Tilted cards preserve all four projected corners, including the taper,
with the same perspective mapping as the card. Blur padding is projected with
the body. Releasing a card restores a plain sprite; mesh geometry is disposed
without destroying the shared texture. Edge-on shadows are hidden until valid.

Shadows fall on the board only, below all pieces; they do not fall onto other
pieces. Overlapping shadows darken naturally. New rendering mechanisms that hide
or replace a physical body should hand over its descriptor just as card helpers do.
