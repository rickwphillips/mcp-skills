
# Royal Casino — Project Skill

## Project Locations
- **Game project**: `Casino-v0.0.1/` (Unity)
- **Tutorial/reference**: `Conn-Casino/` (Unity)
- **Docs & planning**: `royal-casino/` (in FreddyRhetorickProjects)

## Stack
- **Engine**: Unity 2022+ LTS · **Language**: C# · **Architecture**: ScriptableObject-based rule configs
- **Platforms**: PC, Mac, Mobile (iOS/Android)

## What Is Royal Casino?
Fishing-style card game (Casino family). Key difference from standard Casino: **face cards have numerical values**:
- Jack = 11, Queen = 12, King = 13, Ace = 1 or 14 (player's choice)
- Face cards are capturable through builds and combinations
- 2–4 players with partnership support

## Three Actions Per Turn
1. **Capture** — take table cards matching or summing to played card (mandatory if match exists)
2. **Build** — combine played card + table cards into capturable pile (must hold capture card in hand)
3. **Trail** — place card on table (blocked if you own a build or a match exists)

## Build Rules
- Build owners MUST capture or build further (cannot trail)
- Can increase opponent's single build (need new capture card)
- Multiple builds cannot be increased, only added to

## Variants
| Variant | Key Differences |
|---|---|
| **Dominican** | Sweep scoring, endgame restrictions at 18+ pts, mandatory captures |
| **North American** | Captures optional (except builds), no sweeps, no endgame restrictions |
| **Hungarian** | 2-player only, no builds, multiple cards playable simultaneously |

## Scoring (Dominican — Default)
| Achievement | Points |
|---|---|
| Most Cards | 3 |
| Most Spades | 1 |
| 10♦ Big Casino | 2 |
| 2♠ Little Casino | 1 |
| Each Ace | 1 |
| Each Sweep | 1 |
**Win at 21 points.**

## Current Script Structure (`Casino-v0.0.1/Assets/Scripts/`)
- `GameDeck.cs` — deck management
- `GameManager.cs` — game flow and turn state
- `GamePlayer.cs` — player data and hand
- `PlayingCard.cs` — card model
- `UIManager.cs` — UI display

## Conn-Casino Reference Scripts (`Conn-Casino/Assets/Scripts/`)
Reuse patterns from here — avoid re-inventing:
- `GameManager.cs` (27.9K) — singleton pattern, turn-based state machine
- `AIPlayer.cs` (12.4K) — Easy/Medium/Hard difficulty architecture
- `UIManager.cs` (25.5K) — full UI implementation
- `CaptureChecker.cs` — capture combination algorithm
- `ScoringManager.cs` + `ScoringConfig.cs` + `ScoreVariables.cs` — ScriptableObject scoring system
- `Build.cs` — build ownership and modification rules
- `GameLogger.cs` — logging/debugging utility

## Architecture Plan

### Key Systems to Build
1. **Rule Configuration** — ScriptableObjects for card values, capture requirements, scoring, win conditions, endgame restrictions
2. **Card System** — Flexible value (Ace = 1 or 14), suit/rank, visual prefab
3. **Capture Engine** — Valid capture detection, combination calculation, mandatory capture checking
4. **Build System** — Single/multiple builds, ownership tracking, modification rules
5. **AI System** — Easy (random), Medium (tactical), Hard (lookahead/strategic)
6. **Game State Manager** — Turn rotation, hand dealing, scoring, win detection

### ScriptableObject Rule Sets (planned)
```
Assets/ScriptableObjects/RuleSets/
├── RoyalCasino_Dominican.asset
├── RoyalCasino_NorthAmerican.asset
└── RoyalCasino_Hungarian.asset
```

### File Organization (planned)
```
Assets/Scripts/
├── Core/        Card.cs · Deck.cs · GameManager.cs
├── Rules/       RuleSet.cs · CaptureEngine.cs · BuildSystem.cs
├── AI/          AIPlayer.cs · Strategies/
├── Scoring/     ScoringManager.cs
└── UI/
```

## What to Reuse from Conn-Casino
- GameManager singleton + turn state machine
- ScriptableObject scoring system shape
- AI difficulty level architecture
- Card visual prefab approach

## What to Improve Over Conn-Casino
- More modular rule system (variants as configs, not separate code)
- Better UI/logic separation
- Comprehensive unit tests
- Cleaner capture combination algorithm
- Better AI evaluation functions

## Roadmap (2026)
| Quarter | Focus |
|---|---|
| Q1 Jan–Mar | Project structure, rule config design, core card system, basic 2-player Dominican |
| Q2 Apr–Jun | Full build system, Dominican variant, Easy + Medium AI |
| Q3 Jul–Sep | North American variant, Hard AI, visual polish |
| Q4 Oct–Dec | Hungarian variant, custom rule creator, mobile builds, release |

## Reference
- **Rules**: https://www.pagat.com/fishing/royal_casino.html
- **Planning docs**: `royal-casino/.claude/context.md`
