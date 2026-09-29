# HSInspired

HSInspired is a Hearthstone-inspired collectible card game for desktop. Build a
collection, create decks, and play turn-based matches against AI opponents.

## Game modes

- **Constructed:** Build a 30-card deck and play matches with your chosen cards.
- **Arena:** Choose a hero, draft a 30-card deck, and play until 12 wins or 3
  losses. Runs earn rewards.
- **Tavern Brawl:** Play a special preset-deck challenge. The current brawl gives
  both players 30 Unstable Portals.

## Cards and effects

Cards come in four types: minions, spells, weapons, and hero cards. Minions stay
on the board and fight; spells resolve when cast; weapons let heroes attack;
hero cards replace your hero and grant armor.

Effects can deal damage, heal, draw cards, summon minions, change stats or
keywords, freeze or destroy targets, generate cards, and trigger from game events.
Common mechanics include:

- **Battlecry** happens when a minion is played; **Deathrattle** happens when it
  dies. **Secrets** trigger in response to an opponent's action, while **Auras**
  continuously affect cards as long as they are active.
- **Discover** offers a choice of cards. **Overload** locks some mana crystals on
  your next turn.
- **Taunt** forces enemy attacks onto a minion when possible. **Rush** lets a
  minion attack enemy minions right away; **Charge** allows immediate attacks.
  **Windfury** grants an extra attack.
- **Divine Shield** blocks one instance of damage. **Stealth** and **Elusive**
  limit targeting. **Lifesteal** heals your hero when its source deals damage;
  **Poisonous** destroys minions it damages; **Spell Damage** boosts spell damage.

## Card sets

The catalog currently includes cards from Basic, Classic, Curse of Naxxramas,
Goblins vs Gnomes, Blackrock Mountain, The Grand Tournament, League of Explorers,
Whispers of the Old Gods, One Night in Karazhan, Mean Streets of Gadgetzan,
Journey to Un'Goro, and Knights of the Frozen Throne.

## Visual effects

The game features animated card auras, premium card appearances, board shadows,
ghostly mist and particles, card and Secret reveals, combat, and selected
hero-power animations. In development, press **F3** to toggle GPU effects.

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
npm run dev
```