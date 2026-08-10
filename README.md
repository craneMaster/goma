# 五麻 — 5-Player Online Mahjong

Browser client for a **5-player** mahjong table with **draw** and **discard**. Built for local or LAN play with a shared room code.

## Tile set

| Component | Count |
|-----------|-------|
| Characters (万), dots (筒), bamboos (条) 1–9 | 5 copies each → 135 |
| Winds 东南西北**花** | 5 copies each → 25 |
| Dragons 中发白 | 5 copies each → 15 |
| **Total** | **175 tiles** |

Seat winds: 东 · 南 · 西 · 北 · **花** (fifth wind tile, same suit as other winds).

## Run

```bash
cd mahjong
npm install
npm start
```

Open **http://localhost:3847** in five browser tabs (or five devices on the same network). Use the same room code (default `TABLE`), fill all five seats, then the host chooses **game length** and clicks **Start game**.

## Turn flow

1. Deal: each player 13 tiles; dealer (东) gets 14 and discards first.
2. On your turn: a tile is drawn automatically from the wall → **discard** (or declare closed melds after drawing).
3. After each discard, other players may **claim** or **pass**. Players with **no valid claim auto-pass**.
4. Turn passes counter-clockwise when everyone passes.

## Round names (riichi-style)

Hands are labeled like **East 1**, **East 3, 2 repeats**, **South 1**, etc.

- **Round wind:** East → South → West → North (场风).
- **Number:** 1–5 within each round wind (one hand per dealer seat in the 5-player table).
- **Repeats (本場):** +1 when the dealer keeps (wins, or is ready at an exhaustive draw); **reset to 0** when a non-dealer wins. The round number only advances when the dealer seat passes.
- **Game length (host):** East only · East–South · East–West · East–North (full). Only the **host** chooses length at start; it is **locked** for the rest of the match (unlocked again for a rematch after game over). The match ends when that final wind is finished **and** someone has at least **50,000** points.
- **Tiebreaker:** If the scheduled winds end with nobody at 50k, play one extra go-around of the **next** wind. During that go-around the match ends as soon as anyone reaches 50k (or when the go-around finishes).
- **Negative points:** the match ends immediately after any hand that leaves a player below 0.
- **Uma (match end):** placement bonus **+20 / +10 / 0 / −10 / −20** (×1000 points).

## Melds

| Action | Rule |
|--------|------|
| **Chi 吃** | Numbered suits only; from the **next** seat in turn order (e.g. 南 chi on 东's discard). Sequence of 3. |
| **Large chi 大吃** | Same as chi, but from the **second** seat after the discarder in turn order; lower priority than chi. |
| **Pon 碰** | 2 matching in hand + discard → meld of 3. |
| **Kan 杠** | 3 matching + discard → meld of 4; **supplement draw** from wall end. |
| **Kin 檎** | 4 matching + discard → meld of 5 (five-of-a-kind); **two** supplement draws + **two** dora indicators. |
| **Ankan** | 4 in hand on your turn (before draw); closed kan + supplement. |
| **Kakan** | Add 4th tile to an open pon after you drew; becomes kan + supplement. |
| **Kin 檎 (from kan)** | Upgrade open kan (or closed kan via discard) with the 5th copy; one supplement + one dora. |
| **Closed kin 檎** | All 5 in hand on your turn; closed kin + **two** supplements + **two** dora. |

**Claim priority:** Win > Kin > Kan > Pon > Chi > Large chi. Ties go to the player closest counter-clockwise from the discarder.

**Swap calling (kuikae) banned:** After chi/pon/kan/kin on a discard, you cannot discard another copy of the called tile on that turn. After chi/large chi, you also cannot discard a tile that completes the same wait with the two tiles you used from hand (e.g. chi 4 with 23 → cannot discard 1 or 4). Claims that would leave no legal discard are not offered.

## Winning

Call **Ron** on a discard or **Tsumo** on your draw when your hand is valid (14 tiles total):

- **Standard:** four melds (sequences or triplets; open melds count) plus one pair.
- **Seven pairs:** seven pairs, all concealed (no open melds).

- **Tsumo:** on your turn with 14 tiles (after drawing, or dealer’s opening 14).
- **Ron:** during the claim window on another player’s discard.

## Riichi 立直

When your hand is **closed** (no open melds; **closed kan/kin are OK**) and **tenpai** (one tile from winning), you may **Riichi 立直**:

- Locks the hand: only **discard**, **win**, and **closed kan/kin** (no chi/pon/open claims).
- Declare after drawing when tenpai (discard a tile that keeps you tenpai), or when discarding after a meld claim.
- After the declaration discard, if you cannot **tsumo** or declare **closed kan/kin**, the drawn tile is **auto-discarded** (tsumogiri).

A **立直** badge appears on your seat. Other players still auto-pass if they have no claims.

## Stack

- **Node.js** + **Express** + **Socket.IO**
- Static client in `public/`

## API

- `GET /api/info` — deck metadata (`deckSize: 175`, etc.)

Socket events: `join`, `start`, `discard` → server pushes `state` to each player (your hand only visible to you). Tiles are drawn automatically at the start of each turn.
