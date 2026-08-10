/** CCW offset from meld owner to discarder (1=right, 2=2nd right, 3=2nd left, 4=left). */
export function discarderOffset(ownerSeat, fromSeat, playerCount = 5) {
  return (fromSeat - ownerSeat + playerCount) % playerCount;
}

function view(tile, { sideways = false, faceDown = false, stackAbove = null } = {}) {
  return { tile, sideways, faceDown, stackAbove };
}

function fillSideSlots(count, called, handTiles, calledSlotIndex) {
  const slots = new Array(count).fill(null);
  slots[calledSlotIndex] = called;
  let h = 0;
  for (let i = 0; i < count; i++) {
    if (i === calledSlotIndex) continue;
    slots[i] = handTiles[h % handTiles.length];
    h++;
  }
  return slots;
}

/** Stack added tile on the sideways base (middle if two sideways) — shouminkan / kakan. */
function attachKakanStack(views, added) {
  const stackAbove = view(added, { sideways: true });
  const sidewaysIndices = views.map((v, i) => (v.sideways ? i : -1)).filter((i) => i >= 0);
  const targetIdx =
    sidewaysIndices.length === 1
      ? sidewaysIndices[0]
      : sidewaysIndices.length >= 2
        ? 1
        : views.length - 1;
  const base = views[targetIdx];
  views[targetIdx] = view(base.tile, {
    sideways: base.sideways,
    faceDown: base.faceDown,
    stackAbove,
  });
  return views;
}

/**
 * Open pon layout (3 slots).
 * Matches calls/pon-*.png (CCW offset from owner to discarder):
 *   4 left      → pon-left.png      S U U
 *   3 2nd left  → pon-left2.png     S S U
 *   1 right     → pon-right.png     U U S
 *   2 2nd right → pon-right2.png    U S S
 */
function getOpenPonViews(ownerSeat, fromSeat, called, handTiles, playerCount) {
  const off = discarderOffset(ownerSeat, fromSeat, playerCount);
  const h0 = handTiles[0] ?? called;
  const h1 = handTiles[1] ?? called;
  if (off === 4) {
    return [view(called, { sideways: true }), view(h0), view(h1)];
  }
  if (off === 3) {
    return [view(h0, { sideways: true }), view(h1, { sideways: true }), view(called)];
  }
  if (off === 1) {
    return [view(h0), view(h1), view(called, { sideways: true })];
  }
  if (off === 2) {
    return [view(h0), view(h1, { sideways: true }), view(called, { sideways: true })];
  }
  return null;
}

/**
 * Daiminkan (open kan from discard) — 4 slots, one sideways called tile.
 * Matches calls/daiminkan-*.png:
 *   4 left      → daiminkan-left.png   S U U U
 *   3 2nd left  → daiminkan-left2.png  U S U U
 *   2 2nd right → daiminkan-right2.png U U S U
 *   1 right     → daiminkan-right.png  U U U S
 */
function getDaiminkanViews(ownerSeat, fromSeat, called, handTiles, playerCount) {
  const off = discarderOffset(ownerSeat, fromSeat, playerCount);
  const slotIndex = { 4: 0, 3: 1, 2: 2, 1: 3 }[off];
  if (slotIndex == null) return null;

  const slots = fillSideSlots(4, called, handTiles, slotIndex);
  return slots.map((t, i) =>
    i === slotIndex ? view(called, { sideways: true }) : view(t)
  );
}

/**
 * Open kin (minkin) — same 4-column positions as daiminkan, but the called
 * column is a stack of two sideways tiles (5 tiles total).
 * Matches calls/minkin-*.png:
 *   4 left      → minkin-left.png    [S+S] U U U
 *   3 2nd left  → minkin-left2.png   U [S+S] U U
 *   2 2nd right → minkin-right2.png  U U [S+S] U
 *   1 right     → minkin-right.png   U U U [S+S]
 *
 * @param {*} stacked — 2nd sideways tile (hand tile on a fresh kin, or added when kan→kin)
 */
function getMinkinViews(ownerSeat, fromSeat, called, handTiles, stacked, playerCount) {
  const off = discarderOffset(ownerSeat, fromSeat, playerCount);
  const slotIndex = { 4: 0, 3: 1, 2: 2, 1: 3 }[off];
  if (slotIndex == null) return null;

  const stackTile = stacked ?? handTiles[0] ?? called;
  const uprights = handTiles.filter((t) => t.id !== stackTile.id);
  const slots = fillSideSlots(4, called, uprights.length ? uprights : handTiles, slotIndex);

  return slots.map((t, i) => {
    if (i !== slotIndex) return view(t);
    return view(called, {
      sideways: true,
      stackAbove: view(stackTile, { sideways: true }),
    });
  });
}

/**
 * Shouminkan / kakan — pon layout with 4th tile stacked on a sideways tile.
 * Matches calls/shouminkan-*.png (same sideways pattern as pon-*, stack on
 * the single sideways tile, or the middle one when there are two).
 */
function getShouminkanViews(ownerSeat, fromSeat, called, handTiles, added, playerCount) {
  const ponViews = getOpenPonViews(ownerSeat, fromSeat, called, handTiles, playerCount);
  if (!ponViews || !added) return null;
  return attachKakanStack(ponViews, added);
}

/**
 * @param {object} meld
 * @param {number} ownerSeat
 * @param {number} [playerCount]
 */
export function getMeldTileViews(meld, ownerSeat, playerCount = 5) {
  const { type, tiles, open, fromSeat, calledTileId, addedTileId } = meld;
  if (!tiles?.length) return [];

  const calledId = calledTileId ?? tiles[tiles.length - 1]?.id;
  const called = tiles.find((t) => t.id === calledId) ?? tiles[tiles.length - 1];
  const fromHand = tiles.filter((t) => t.id !== calledId);
  const added = addedTileId ? tiles.find((t) => t.id === addedTileId) : null;

  if (type === 'chi' || type === 'largeChi') {
    /* Sequence order by rank; called tile sideways like calls/chii.png & large-chii.png */
    const others = [...tiles]
      .filter((t) => t.id !== calledId)
      .sort((a, b) => a.rank - b.rank);
    if (type === 'largeChi') {
      /* calls/large-chii.png: upright · called sideways (middle) · upright */
      return [
        view(others[0]),
        view(called, { sideways: true }),
        view(others[1] ?? others[0]),
      ];
    }
    /* calls/chii.png: called sideways (left) · upright · upright */
    return [view(called, { sideways: true }), ...others.map((t) => view(t))];
  }

  if (type === 'pon') {
    if (!open || fromSeat == null) {
      return tiles.map((t) => view(t));
    }
    return getOpenPonViews(ownerSeat, fromSeat, called, fromHand, playerCount) ?? tiles.map((t) => view(t));
  }

  if (type === 'kan') {
    if (!open) {
      /* calls/ankan.png — four in a row; ends face-down */
      return tiles.map((t, i) =>
        view(t, { faceDown: i === 0 || i === tiles.length - 1 })
      );
    }

    /* Shouminkan / kakan: pon + stacked tile (calls/shouminkan-*.png) */
    if (added && tiles.length === 4 && fromSeat != null) {
      const ponHand = tiles.filter((t) => t.id !== calledId && t.id !== added.id);
      const shou = getShouminkanViews(ownerSeat, fromSeat, called, ponHand, added, playerCount);
      if (shou) return shou;
    }

    /* Daiminkan: open kan from discard (calls/daiminkan-*.png) */
    if (fromSeat != null) {
      const handTiles = tiles.filter((t) => t.id !== calledId);
      const dai = getDaiminkanViews(ownerSeat, fromSeat, called, handTiles, playerCount);
      if (dai) return dai;
    }

    return tiles.map((t) => view(t));
  }

  if (type === 'kin') {
    if (!open) {
      /* calls/ankin.png — five in a row; ends face-down (ankan + middle) */
      return tiles.map((t, i) =>
        view(t, { faceDown: i === 0 || i === tiles.length - 1 })
      );
    }

    if (fromSeat == null) {
      return tiles.map((t) => view(t));
    }

    /* Open kin (minkin): daiminkan column + stacked sideways pair — calls/minkin-*.png */
    const handTiles = tiles.filter((t) => t.id !== calledId);
    const stacked = added ?? handTiles[0] ?? null;
    const uprightSource =
      stacked != null ? handTiles.filter((t) => t.id !== stacked.id) : handTiles;
    const minkin = getMinkinViews(
      ownerSeat,
      fromSeat,
      called,
      uprightSource.length ? uprightSource : handTiles,
      stacked,
      playerCount
    );
    if (minkin) return minkin;

    return tiles.map((t) => view(t));
  }

  return tiles.map((t) => view(t));
}
