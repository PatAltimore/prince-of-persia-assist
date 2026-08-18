import { Apple2 } from 'js/apple2';

/**
 * Memory addresses resolved from build-tooling/pop-build/obj/MASTER.LST,
 * same technique as EmulatorController.ts's JOYON_ADDRESS.
 *
 * - EQ.S's `level` flag ($03F4: "463 level ds 1") is used below purely as
 *   a *change trigger* ("something happened, try a rebuild"), never
 *   compared against a specific value to decide whether to show or hide
 *   the map — see update()'s comment for why. It's read directly from the
 *   *aux* RAM bank (readAuxRam(), bypassing the live RAMRD softswitch
 *   entirely), which took two wrong turns to arrive at: first a
 *   main-bank-only direct read (on the theory that HIRES.S's rendering
 *   flips RAMRD to aux many times per frame and an external poll could
 *   catch it mid-flip — true, but backwards about which bank is "real");
 *   then a plain `cpu.read()` (respecting whatever the softswitch
 *   currently says), on the theory that this must be correct since it's
 *   exactly what the 6502 program itself would see. Both were confirmed
 *   wrong *live*, side by side, during real gameplay: `cpu.read()` and a
 *   direct aux-bank read agreed on the correct, current value, while a
 *   direct main-bank read was stuck on stale data — but `cpu.read()`
 *   still isn't reliable *by itself*, because RAMRD keeps moving under
 *   it: it happened to catch the aux side when checked in level 1, then
 *   caught a stale main-bank moment later in level 2 (observed as the
 *   map successfully building once, then getting stuck mid-level as if
 *   `level` had dropped back to 0 — it hadn't; the poll just landed on
 *   the wrong bank that time). Aux is where the game's own code actually
 *   keeps this value current during real gameplay, so reading it directly
 *   — the same technique already used for the room-link table below — is
 *   what actually removes the timing dependency instead of just usually
 *   getting lucky.
 * - GAMEEQ.S's `KidScrn` ($005B, "611 KidScrn ds 1", part of the "dum Kid"
 *   per-character struct) is the screen the kid is actually standing on —
 *   confirmed by AUTO.S's guard-transfer logic, which reads it as "ldx
 *   KidScrn ;new scrn" exactly when the kid crosses into a fresh screen
 *   during ordinary movement, and by TOPCTRL.S's level-transition checks
 *   (e.g. "When kid falls off screen 1, cut to next level"), which compare
 *   against it and must fire promptly during normal play.
 *
 *   `VisScrn` ($00CB) looks like the obvious choice by name and is *also*
 *   real main zero page, but it turns out to be the wrong variable: the
 *   only two `sta VisScrn` sites in the whole source are level-init (reset
 *   to 0) and a scripted "cut to screen" routine used for guard-spawn/
 *   cutscene-style forced transitions — it's never updated by ordinary
 *   walking-triggered scrolling. That's exactly why the map used to build
 *   correctly at level start (KidScrn and VisScrn coincidentally agree on
 *   the spawn screen) but never advanced as the player moved: VisScrn
 *   quietly never changes on foot, so the room the player *actually*
 *   arrived at never got reflected here.
 * - `SCRNUM` ($0023) also exists but CTRL.S/MOVER.S use it as a scratch
 *   parameter for one-off per-character screen lookups, not a stable
 *   current-screen indicator.
 * - Each level's 24-screen room-link table lives in *auxiliary* RAM: EQ.S
 *   groups `blueprnt` ($b700) under its "Auxmem" heading alongside the
 *   other bulk per-level data, swapped into the //e's aux 64K bank when a
 *   level loads. `MAP` resolves to $BEA0 (96 bytes: 24 screens x 4 bytes).
 *   CTRLSUBS.S's GETLEFT/GETRIGHT/GETUP/GETDOWN (`lda MAP-4,x` / `-3,x` /
 *   `-2,x` / `-1,x` with `x = screen*4`) confirm both the byte order per
 *   screen block — [Left, Right, Above, Below] — and that screens are
 *   1-indexed with 0 meaning "no neighbor" (edge of level).
 * - `BLUETYPE` is the *first* field of the same `blueprnt` struct, so it
 *   starts at $B700 itself: 720 bytes = 24 screens x 30 tiles, one byte per
 *   tile. Every read site (MOVER.S, FRAMEADV.S, SUBS.S, etc.) masks each
 *   byte with `idmask` (`%00011111`, EQ.S) before comparing it against a
 *   named piece ID from BGDATA.S — the top 3 bits carry unrelated flags
 *   (`secmask`/`reqmask`). Piece IDs used below: `sword = 22`, `flask
 *   (potion) = 10`, `exit = 16` (labeled "stairs" in the UI, not "exit" —
 *   real level data shows this piece ID appearing on *multiple* screens in
 *   the same level, e.g. two separate staircases in one level-2 playthrough,
 *   so despite its handlers being named `openexit`/`animexit`/`drawexitb`
 *   in the source, it isn't uniquely "the level's exit"; it's a general
 *   staircase/vertical-traversal tile, and calling it "exit" in the UI
 *   overclaimed uniqueness it doesn't have. Actual level-to-level
 *   completion is driven by other, level-specific logic entirely —
 *   TOPCTRL.S hardcodes things like "when kid exits screen 23" for level
 *   12 and "Level 14, screen 5 is princess's room" for the ending, with no
 *   reference to this tile type at all). BGDATA.S also defines `exit2 =
 *   17`, which shows up right next to every `exit` tile in practice
 *   (presumably the other half of the same 2-tile staircase graphic) but
 *   has no `cmp #exit2` anywhere in the source, so it's not treated as a
 *   separate marker here.
 * - None of these piece IDs are re-checked for "has this actually been
 *   picked up since the level loaded" — CTRL.S's pickup code (`RemoveObj`)
 *   edits this same BLUETYPE data in place once an object is taken, so a
 *   badge for an already-collected sword/potion would go stale if this
 *   were only read once at rebuild() time. See readImportantScreens()'s
 *   call site for how that's avoided.
 */
const LEVEL_ADDRESS = 0x03f4;
const KIDSCRN_ADDRESS = 0x005b;
const MAP_TABLE_AUX_ADDRESS = 0xbea0;
const BLUETYPE_AUX_ADDRESS = 0xb700;
const SCREEN_COUNT = 24;
const TILES_PER_SCREEN = 30;
const PIECE_ID_MASK = 0x1f;
const PIECE_ID_FLASK = 10;
const PIECE_ID_EXIT = 16;
const PIECE_ID_SWORD = 22;

const CELL_WIDTH_PX = 34;
const CELL_HEIGHT_PX = 24;
// Keep in sync with .room-map-grid's CSS `gap` — used to compute pixel
// positions for the connector-line overlay, which CSS grid layout doesn't
// expose directly.
const CELL_GAP_PX = 3;

/**
 * Direct read-only access to the aux RAM bank's live backing array —
 * bypassing the cost of `apple2.getState()`, which copies both 48KB RAM
 * banks and serializes CPU/video/IO/MMU state this doesn't need, so it's
 * cheap enough to call every tick. Unlike `level`/`KidScrn` (read via
 * `cpu.read()` — see the file-level comment on why that's the correct
 * choice there), the level's room-link table lives in aux RAM full stop —
 * there's no "which bank is it really in" question for this one, so
 * bypassing the softswitch here is just an optimization, not a
 * correctness fix.
 *
 * `ram` is a private field on Apple2 (js/apple2.ts), not part of its
 * public API — this project already reaches into it directly elsewhere
 * for the same reason (see docs/SPIKE-NOTES.md's
 * `apple2.ram[0].mem.buffer` check), and the field itself is part of a
 * pinned vendored dependency (web/vendor/apple2js), so this is a
 * deliberate, documented exception rather than an accident.
 */
function readAuxRam(apple2: Apple2): Uint8Array | undefined {
    return (apple2 as unknown as { ram?: Array<{ mem: Uint8Array }> }).ram?.[1]?.mem;
}

interface ScreenLinks {
    left: number;
    right: number;
    up: number;
    down: number;
}

interface Coord {
    x: number;
    y: number;
}

type ImportantKind = 'sword' | 'potion' | 'exit';

const IMPORTANT_BADGES: Record<ImportantKind, string> = {
    sword: 'S',
    potion: 'P',
    exit: 'X',
};

// Labeled "stairs" rather than "exit" in the UI even though the internal
// key/piece-ID name (and the source's own routine names) say "exit" — see
// the file-level comment on PIECE_ID_EXIT for why "exit" overclaims
// uniqueness this tile doesn't have.
const IMPORTANT_LABELS: Record<ImportantKind, string> = {
    sword: 'sword',
    potion: 'potion',
    exit: 'stairs',
};

function readScreenLinks(auxRam: Uint8Array): Map<number, ScreenLinks> {
    const links = new Map<number, ScreenLinks>();
    for (let screen = 1; screen <= SCREEN_COUNT; screen++) {
        const base = MAP_TABLE_AUX_ADDRESS + (screen - 1) * 4;
        links.set(screen, {
            left: auxRam[base],
            right: auxRam[base + 1],
            up: auxRam[base + 2],
            down: auxRam[base + 3],
        });
    }
    return links;
}

/**
 * Scans each screen's 30 background tiles for sword/potion/exit piece IDs
 * — static level layout data, so this only needs to run once per level
 * (alongside readScreenLinks(), from the same aux-RAM snapshot) rather
 * than tracking whether a given item has actually been picked up.
 */
function readImportantScreens(auxRam: Uint8Array): Map<number, Set<ImportantKind>> {
    const result = new Map<number, Set<ImportantKind>>();
    for (let screen = 1; screen <= SCREEN_COUNT; screen++) {
        const base = BLUETYPE_AUX_ADDRESS + (screen - 1) * TILES_PER_SCREEN;
        let kinds: Set<ImportantKind> | undefined;
        for (let tile = 0; tile < TILES_PER_SCREEN; tile++) {
            const pieceId = auxRam[base + tile] & PIECE_ID_MASK;
            let kind: ImportantKind | undefined;
            if (pieceId === PIECE_ID_SWORD) {
                kind = 'sword';
            } else if (pieceId === PIECE_ID_FLASK) {
                kind = 'potion';
            } else if (pieceId === PIECE_ID_EXIT) {
                kind = 'exit';
            }
            if (kind) {
                kinds ??= new Set();
                kinds.add(kind);
            }
        }
        if (kinds) {
            result.set(screen, kinds);
        }
    }
    return result;
}

/**
 * Lays out every screen reachable from `start` on an integer grid by
 * walking the room-link graph — one step right/left/up/down per link,
 * exactly mirroring the levels' real physical layout (that's how the
 * level designer placed connected screens), so no fancier graph-layout
 * algorithm is needed.
 *
 * This assumes the graph is planar — every link's reverse also points
 * back the opposite direction, so there's exactly one consistent way to
 * place each screen relative to its neighbors. Real levels aren't
 * guaranteed to hold to that: Mechner's level design uses non-obvious
 * shortcuts (trapdoors, drops) whose link doesn't correspond to physical
 * adjacency at all. When BFS reaches an already-placed screen via a
 * second, conflicting link, this keeps whichever placement it found
 * first and silently drops the conflicting one from the grid's
 * coordinates — the link itself isn't lost, though: see
 * findJumpEdges(), which is what actually surfaces these to the player
 * instead of just leaving them as an unexplained gap in the grid.
 */
function layoutScreens(
    links: Map<number, ScreenLinks>,
    start: number
): Map<number, Coord> {
    const coords = new Map<number, Coord>();
    if (!links.has(start)) {
        return coords;
    }

    coords.set(start, { x: 0, y: 0 });
    const queue = [start];
    while (queue.length > 0) {
        const screen = queue.shift()!;
        const { x, y } = coords.get(screen)!;
        const link = links.get(screen)!;
        const neighbors: Array<[number, number, number]> = [
            [link.left, x - 1, y],
            [link.right, x + 1, y],
            [link.up, x, y - 1],
            [link.down, x, y + 1],
        ];
        for (const [neighbor, nx, ny] of neighbors) {
            if (neighbor !== 0 && links.has(neighbor) && !coords.has(neighbor)) {
                coords.set(neighbor, { x: nx, y: ny });
                queue.push(neighbor);
            }
        }
    }
    return coords;
}

interface JumpEdge {
    a: number;
    b: number;
}

/**
 * Finds every link whose two screens *aren't* grid-adjacent in `coords` —
 * these are the non-planar "jumps" layoutScreens() can't represent by
 * position alone (see its doc comment). Each unordered pair is reported
 * once even if the link exists in both directions.
 */
function findJumpEdges(
    links: Map<number, ScreenLinks>,
    coords: Map<number, Coord>
): JumpEdge[] {
    const seen = new Set<string>();
    const edges: JumpEdge[] = [];
    for (const [screen, coord] of coords) {
        const link = links.get(screen);
        if (!link) {
            continue;
        }
        for (const neighbor of [link.left, link.right, link.up, link.down]) {
            if (neighbor === 0 || neighbor === screen) {
                continue;
            }
            const neighborCoord = coords.get(neighbor);
            if (!neighborCoord) {
                continue; // not placed at all (e.g. a different connected component)
            }
            const dx = Math.abs(coord.x - neighborCoord.x);
            const dy = Math.abs(coord.y - neighborCoord.y);
            const isGridAdjacent = (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
            if (isGridAdjacent) {
                continue;
            }
            const key = screen < neighbor ? `${screen}-${neighbor}` : `${neighbor}-${screen}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            edges.push({ a: screen, b: neighbor });
        }
    }
    return edges;
}

/**
 * Renders the Map tab: a compact "Level N" line (from EQ.S's `level`
 * variable) plus a fog-of-war map of that level's screens, built from the
 * level's own room-link data and revealed as the player explores.
 */
export function renderRoomMap(
    container: HTMLElement,
    apple2: Apple2
): { update: () => void; debug: () => unknown } {
    const cpu = apple2.getCPU();
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Map';
    container.appendChild(heading);

    const levelLine = document.createElement('p');
    levelLine.className = 'room-map-level';
    container.appendChild(levelLine);

    const emptyState = document.createElement('p');
    emptyState.className = 'cheat-intro room-map-empty';
    emptyState.textContent =
        'Builds once you’re actually in a level (not the title/attract screen).';
    container.appendChild(emptyState);

    const gridWrap = document.createElement('div');
    gridWrap.className = 'room-map-grid-wrap';
    gridWrap.hidden = true;
    container.appendChild(gridWrap);

    const grid = document.createElement('div');
    grid.className = 'room-map-grid';
    gridWrap.appendChild(grid);

    // Overlays `grid`, drawing a connector line for any link that *doesn't*
    // land in a grid-adjacent cell — see findJumpEdges()'s doc comment for
    // why that happens and why it's drawn explicitly rather than treated
    // as a layout bug.
    const connectorsSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    connectorsSvg.setAttribute('class', 'room-map-connectors');
    gridWrap.appendChild(connectorsSvg);

    const legend = document.createElement('p');
    legend.className = 'room-map-legend';
    legend.hidden = true;
    (['sword', 'potion', 'exit'] as const).forEach((kind, i) => {
        if (i > 0) {
            legend.appendChild(document.createTextNode('   '));
        }
        const badge = document.createElement('span');
        badge.className = 'room-map-badge';
        badge.textContent = IMPORTANT_BADGES[kind];
        legend.appendChild(badge);
        legend.appendChild(document.createTextNode(` ${IMPORTANT_LABELS[kind]}`));
    });
    container.appendChild(legend);

    const jumpLegend = document.createElement('p');
    jumpLegend.className = 'room-map-legend room-map-jump-legend';
    jumpLegend.hidden = true;
    jumpLegend.textContent =
        '- - - dashed line: a shortcut/drop that connects to a room not physically next to it';
    container.appendChild(jumpLegend);

    let links = new Map<number, ScreenLinks>();
    let coords = new Map<number, Coord>();
    let cells = new Map<number, HTMLDivElement>();
    let jumpLines: Array<{ a: number; b: number; el: SVGLineElement }> = [];
    let important = new Map<number, Set<ImportantKind>>();
    let visited = new Set<number>();
    let currentScreen = 0;

    let lastLevel = -1;
    let pendingLevel = 0;
    let needsRebuild = true;
    // While waiting for a level's aux blueprint to finish loading (see
    // update()), this is the room-link signature seen on the *previous*
    // tick, so two consecutive ticks can be compared.
    let pendingLinkSignature: string | undefined;

    const renderVisibility = () => {
        const frontier = new Set<number>();
        for (const screen of visited) {
            const link = links.get(screen);
            if (!link) {
                continue;
            }
            for (const neighbor of [link.left, link.right, link.up, link.down]) {
                if (neighbor !== 0 && !visited.has(neighbor)) {
                    frontier.add(neighbor);
                }
            }
        }

        const shown = new Set<number>();
        for (const [screen, cell] of cells) {
            const isVisited = visited.has(screen);
            const isFrontier = !isVisited && frontier.has(screen);
            const isCurrent = screen === currentScreen;
            const kinds = important.get(screen);
            // A hidden cell that happens to hold something worth knowing
            // about (sword/potion/exit) still shows just that hint, without
            // the border/background that would give away the room's shape
            // or connections — a middle ground between full fog and a full
            // reveal, and the whole point of a *hints* tool.
            const isImportantHint = !isVisited && !isFrontier && !!kinds;
            const isHidden = !isVisited && !isFrontier && !isImportantHint;
            if (!isHidden) {
                shown.add(screen);
            }

            cell.classList.toggle('room-map-hidden', isHidden);
            cell.classList.toggle('room-map-frontier', isFrontier);
            cell.classList.toggle('room-map-important-hint', isImportantHint);
            cell.classList.toggle('room-map-current', isCurrent);

            let text = isCurrent ? '●' : '';
            if (kinds) {
                for (const kind of kinds) {
                    text += IMPORTANT_BADGES[kind];
                }
            }
            cell.textContent = text;
            cell.title = kinds
                ? [...kinds].map((k) => IMPORTANT_LABELS[k]).join(', ')
                : '';
        }

        // A jump line only makes sense once both ends are at least
        // hinted-at — otherwise it'd draw a line pointing at a room the
        // player has no idea exists yet, which isn't a hint, it's a
        // spoiler of the level's shape.
        for (const { a, b, el } of jumpLines) {
            el.classList.toggle('room-map-jump-hidden', !shown.has(a) || !shown.has(b));
        }
    };

    const rebuild = () => {
        grid.innerHTML = '';
        cells = new Map();
        visited = new Set([currentScreen]);

        const auxRam = readAuxRam(apple2);
        links = auxRam ? readScreenLinks(auxRam) : new Map();
        important = auxRam ? readImportantScreens(auxRam) : new Map();
        coords = layoutScreens(links, currentScreen);

        emptyState.hidden = coords.size > 0;
        gridWrap.hidden = coords.size === 0;
        legend.hidden = coords.size === 0;
        jumpLegend.hidden = true; // re-shown below once jump edges (if any) are known
        // pendingLevel is whatever `level` most recently read as when this
        // rebuild was triggered — shown only once we actually have real
        // map data to back it up, not just because `level` changed (see
        // the file-level comment on why `level`'s exact value isn't
        // otherwise trusted).
        levelLine.textContent = coords.size > 0 ? `Level ${pendingLevel}` : '';

        if (coords.size === 0) {
            return;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const { x, y } of coords.values()) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }

        const numCols = maxX - minX + 1;
        const numRows = maxY - minY + 1;
        grid.style.gridTemplateColumns = `repeat(${numCols}, ${CELL_WIDTH_PX}px)`;
        grid.style.gridTemplateRows = `repeat(${numRows}, ${CELL_HEIGHT_PX}px)`;

        for (const [screen, { x, y }] of coords) {
            const cell = document.createElement('div');
            cell.className = 'room-map-cell';
            cell.style.gridColumn = String(x - minX + 1);
            cell.style.gridRow = String(y - minY + 1);
            grid.appendChild(cell);
            cells.set(screen, cell);
        }

        const totalWidthPx = numCols * CELL_WIDTH_PX + (numCols - 1) * CELL_GAP_PX;
        const totalHeightPx = numRows * CELL_HEIGHT_PX + (numRows - 1) * CELL_GAP_PX;
        connectorsSvg.setAttribute('width', String(totalWidthPx));
        connectorsSvg.setAttribute('height', String(totalHeightPx));
        connectorsSvg.innerHTML = '';
        const cellCenterPx = (x: number, y: number) => ({
            cx: (x - minX) * (CELL_WIDTH_PX + CELL_GAP_PX) + CELL_WIDTH_PX / 2,
            cy: (y - minY) * (CELL_HEIGHT_PX + CELL_GAP_PX) + CELL_HEIGHT_PX / 2,
        });
        jumpLines = findJumpEdges(links, coords).map(({ a, b }) => {
            const posA = cellCenterPx(coords.get(a)!.x, coords.get(a)!.y);
            const posB = cellCenterPx(coords.get(b)!.x, coords.get(b)!.y);
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('class', 'room-map-jump-line');
            line.setAttribute('x1', String(posA.cx));
            line.setAttribute('y1', String(posA.cy));
            line.setAttribute('x2', String(posB.cx));
            line.setAttribute('y2', String(posB.cy));
            connectorsSvg.appendChild(line);
            return { a, b, el: line };
        });
        jumpLegend.hidden = jumpLines.length === 0;

        renderVisibility();
    };

    const update = () => {
        // `level` is read purely to notice "something happened, worth a
        // rebuild attempt" — never compared against a specific value (see
        // the file-level comment). The rebuild itself is keyed off
        // KidScrn, which is what actually decides whether real map data
        // exists to show.
        const level = readAuxRam(apple2)?.[LEVEL_ADDRESS];
        if (level !== undefined && level !== lastLevel) {
            lastLevel = level;
            pendingLevel = level;
            needsRebuild = true;
            pendingLinkSignature = undefined;
        }

        const screen = cpu.read(KIDSCRN_ADDRESS);

        if (needsRebuild) {
            if (screen === 0) {
                return; // kid hasn't spawned into the new level yet
            }
            // Don't trust the room-link table the instant KidScrn becomes
            // valid: after a level change, the level's own load routine
            // (reading the new level's blueprint off the emulated disk)
            // may still be filling in aux RAM for a while — real disk I/O
            // latency, not a fixed number of frames, so a flat tick-count
            // delay isn't reliable (this previously showed the *previous*
            // level's stale layout after a fast level change, e.g. via
            // the SKIP cheat). Instead, wait for this screen's room-link
            // bytes to read the same on two consecutive ticks — once the
            // load is done they stop changing, whereas mid-load reads
            // that keep shifting won't match twice in a row.
            //
            // `level > 0` is required too, but only as part of the final
            // commit check below, not as a blanket early-return here: some
            // levels (2/4/6/8/9/12) play a "Princess cut" cutscene before
            // the level actually starts (MASTER.S's CUTPRINCESS), during
            // which there's no kid on screen and `level` genuinely reads 0
            // — briefly reusing the same aux memory the level blueprint
            // occupies for cutscene graphics instead. An early return
            // there would interrupt the two-consecutive-ticks signature
            // tracking below every time it happened to land on a 0 read,
            // which turned out to make the whole thing far more fragile
            // than intended — this way, a 0 reading just fails *this*
            // commit attempt (same as any other still-changing signature)
            // without resetting progress made on unrelated ticks.
            const auxRam = readAuxRam(apple2);
            const base = MAP_TABLE_AUX_ADDRESS + (screen - 1) * 4;
            const signature = auxRam
                ? `${screen}:${auxRam[base]},${auxRam[base + 1]},${auxRam[base + 2]},${auxRam[base + 3]}`
                : undefined;

            if (
                signature !== undefined &&
                signature === pendingLinkSignature &&
                level !== undefined &&
                level > 0
            ) {
                currentScreen = screen;
                needsRebuild = false;
                pendingLinkSignature = undefined;
                rebuild();
            } else {
                pendingLinkSignature = signature;
            }
            return;
        }

        if (screen === 0) {
            return;
        }

        // Re-scan for sword/potion/stairs every tick rather than only once
        // at rebuild() time: CTRL.S's pickup code (RemoveObj) edits this
        // same BLUETYPE tile data in place when the player actually grabs
        // an object, so a badge for an already-collected item would
        // otherwise keep showing until the next level change. This scan is
        // 24 screens x 30 bytes — cheap enough to redo every tick without
        // waiting for a specific trigger to know something changed.
        const auxRamForItems = readAuxRam(apple2);
        important = auxRamForItems ? readImportantScreens(auxRamForItems) : important;

        if (screen !== currentScreen && coords.has(screen)) {
            currentScreen = screen;
            visited.add(screen);
        }
        renderVisibility();
    };

    const debug = () => ({
        lastLevel,
        pendingLevel,
        needsRebuild,
        pendingLinkSignature,
        currentScreen,
        coordsSize: coords.size,
        visitedSize: visited.size,
    });

    return { update, debug };
}
