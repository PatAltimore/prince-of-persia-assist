import { Apple2 } from 'js/apple2';
import { captureSnapshot } from '../../emulator/snapshot/SnapshotSerializer';

/**
 * Memory addresses resolved from build-tooling/pop-build/obj/MASTER.LST,
 * same technique as EmulatorController.ts's JOYON_ADDRESS.
 *
 * - EQ.S's `level` flag ($03F4: "463 level ds 1") lives in the $0200-$BFFF
 *   range, which HIRES.S's rendering code flips between main and aux RAM
 *   (via the RAMRD softswitch, $C002/$C003) many times per *frame* while
 *   drawing the screen — not just at level-load boundaries. Reading it with
 *   `cpu.read()`, which reflects whatever bank happens to be switched in at
 *   that instant, intermittently returns aux RAM's unrelated byte at that
 *   same offset instead of the real level number (observed as the level
 *   display flickering between values during ordinary gameplay, and — with
 *   an unlucky enough run of misreads — the map's "wait for a stable
 *   screen" gate never being satisfied at all). Reading main-bank RAM
 *   directly (unaffected by the live softswitch state, see getMainRam()
 *   below) avoids this for both `level` and VisScrn.
 * - GAMEEQ.S's `VisScrn` ($00CB, "469 VisScrn ds 1") is the screen
 *   currently on display — the reliable "current position" read (SCRNUM at
 *   $0023 is a scratch var CTRL.S/MOVER.S reuse for one-off per-character
 *   lookups, not a stable current-screen indicator).
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
 *   (potion) = 10`, `exit = 16` — confirmed as the actual level-exit
 *   staircase via its handlers (MOVER.S's `openexit`/`animexit`,
 *   FRAMEADV.S's `drawexitb`). BGDATA.S also defines `exit2 = 17`, but
 *   grepping the whole source tree turns up no `cmp #exit2` anywhere — it's
 *   unused, so it's deliberately not treated as a second exit ID here.
 */
const LEVEL_ADDRESS = 0x03f4;
const VISSCRN_ADDRESS = 0x00cb;
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

// How many consecutive ticks VisScrn must hold the same nonzero value
// before a freshly-detected level change is trusted enough to rebuild the
// map from aux RAM — the level's own load routine may still be a few
// frames from finishing when `level` itself changes, and reading the
// room-link table mid-load would bake in stale/partial data.
const SCREEN_STABLE_TICKS = 5;

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

const IMPORTANT_LABELS: Record<ImportantKind, string> = {
    sword: 'sword',
    potion: 'potion',
    exit: 'exit',
};

/**
 * Direct read-only view of the main RAM bank's live backing array —
 * bypassing whatever the live RAMRD/RAMWRT softswitch state happens to be
 * (see the file-level comment above), *and* bypassing the cost of
 * `apple2.getState()` (which besides copying both 48KB RAM banks also
 * serializes CPU/video/IO/MMU state this doesn't need). That cost is why
 * this doesn't just call captureSnapshot() every tick the way rebuild()
 * does for the much-less-frequent aux-RAM reads below.
 *
 * `ram` is a private field on Apple2 (js/apple2.ts), not part of its
 * public API — this project already reaches into it directly elsewhere
 * for the same reason (see docs/SPIKE-NOTES.md's
 * `apple2.ram[0].mem.buffer` check), and the field itself is part of a
 * pinned vendored dependency (web/vendor/apple2js), so this is a
 * deliberate, documented exception rather than an accident.
 */
function getMainRam(apple2: Apple2): Uint8Array | undefined {
    return (apple2 as unknown as { ram?: Array<{ mem: Uint8Array }> }).ram?.[0]?.mem;
}

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

/**
 * Renders the Map tab: a compact "Level N" line (from EQ.S's `level`
 * variable) plus a fog-of-war map of that level's screens, built from the
 * level's own room-link data and revealed as the player explores.
 */
export function renderRoomMap(
    container: HTMLElement,
    apple2: Apple2
): { update: () => void; debug: () => unknown } {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Map';
    container.appendChild(heading);

    const levelLine = document.createElement('p');
    levelLine.className = 'room-map-level';
    container.appendChild(levelLine);

    const emptyState = document.createElement('p');
    emptyState.className = 'cheat-intro room-map-empty';
    emptyState.textContent = 'Builds once you’re actually in a level (not the title/attract screen).';
    container.appendChild(emptyState);

    // TEMPORARY: diagnosing https://github.com/PatAltimore/prince-of-persia-assist
    // "map stuck on empty state during real gameplay" — remove once resolved.
    const debugLine = document.createElement('p');
    debugLine.className = 'room-map-debug';
    container.appendChild(debugLine);

    const gridWrap = document.createElement('div');
    gridWrap.className = 'room-map-grid-wrap';
    gridWrap.hidden = true;
    container.appendChild(gridWrap);

    const grid = document.createElement('div');
    grid.className = 'room-map-grid';
    gridWrap.appendChild(grid);

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

    let links = new Map<number, ScreenLinks>();
    let coords = new Map<number, Coord>();
    let cells = new Map<number, HTMLDivElement>();
    let important = new Map<number, Set<ImportantKind>>();
    let visited = new Set<number>();
    let currentScreen = 0;

    let lastLevel = -1;
    let needsRebuild = true;
    let stableScreen = -1;
    let stableCount = 0;

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

            cell.classList.toggle('room-map-hidden', !isVisited && !isFrontier && !isImportantHint);
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
    };

    const rebuild = () => {
        grid.innerHTML = '';
        cells = new Map();
        visited = new Set([currentScreen]);

        const auxRam = captureSnapshot(apple2).ram?.[1]?.mem;
        links = auxRam ? readScreenLinks(auxRam) : new Map();
        important = auxRam ? readImportantScreens(auxRam) : new Map();
        coords = layoutScreens(links, currentScreen);

        emptyState.hidden = coords.size > 0;
        gridWrap.hidden = coords.size === 0;
        legend.hidden = coords.size === 0;

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

        grid.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, ${CELL_WIDTH_PX}px)`;
        grid.style.gridTemplateRows = `repeat(${maxY - minY + 1}, ${CELL_HEIGHT_PX}px)`;

        for (const [screen, { x, y }] of coords) {
            const cell = document.createElement('div');
            cell.className = 'room-map-cell';
            cell.style.gridColumn = String(x - minX + 1);
            cell.style.gridRow = String(y - minY + 1);
            grid.appendChild(cell);
            cells.set(screen, cell);
        }

        renderVisibility();
    };

    /** Resets the display back to "not actually in a level" — used for level 0, the attract-mode demo loop. */
    const showNoLevel = () => {
        levelLine.textContent = '';
        grid.innerHTML = '';
        cells = new Map();
        coords = new Map();
        visited = new Set();
        currentScreen = 0;
        emptyState.hidden = false;
        gridWrap.hidden = true;
        legend.hidden = true;
    };

    let lastMainRamMissing = false;

    const update = () => {
        const mainRam = getMainRam(apple2);
        if (!mainRam) {
            // Shouldn't happen once booted (see getMainRam()'s doc comment)
            // but if apple2js's internals ever shift under this, fail
            // loudly exactly once instead of silently freezing the map.
            if (!lastMainRamMissing) {
                lastMainRamMissing = true;
                console.error('RoomMap: could not reach the main RAM bank; map will not update.');
            }
            return;
        }
        lastMainRamMissing = false;

        const level = mainRam[LEVEL_ADDRESS];
        if (level !== lastLevel) {
            lastLevel = level;
            stableScreen = -1;
            stableCount = 0;
            if (level > 0) {
                levelLine.textContent = `Level ${level}`;
                needsRebuild = true;
            } else {
                // Level 0 is the attract-mode demo loop, not a level the
                // player is actually on.
                needsRebuild = false;
                showNoLevel();
            }
        }

        const screen = mainRam[VISSCRN_ADDRESS];
        stableCount = screen === stableScreen ? stableCount + 1 : 1;
        stableScreen = screen;

        let rebuilt = false;
        let didRebuildAttempt: 'skipped' | 'ran' = 'skipped';
        if (needsRebuild) {
            // Wait for a few consecutive identical reads before trusting
            // this screen number and rebuilding from aux RAM — see
            // SCREEN_STABLE_TICKS' comment.
            if (screen !== 0 && stableCount >= SCREEN_STABLE_TICKS) {
                currentScreen = screen;
                needsRebuild = false;
                didRebuildAttempt = 'ran';
                rebuild();
                rebuilt = coords.size > 0;
            }
        } else if (screen !== 0 && screen !== currentScreen && coords.has(screen)) {
            currentScreen = screen;
            visited.add(screen);
            renderVisibility();
        }

        // TEMPORARY, see debugLine's declaration above.
        debugLine.textContent =
            `debug: rawLevel=${level} rawScreen=${screen} lastLevel=${lastLevel} ` +
            `needsRebuild=${needsRebuild} stableScreen=${stableScreen} stableCount=${stableCount} ` +
            `currentScreen=${currentScreen} coords=${coords.size} visited=${visited.size} ` +
            `rebuildAttempt=${didRebuildAttempt} rebuiltOk=${rebuilt}`;
    };

    const debug = () => ({
        level: lastLevel,
        needsRebuild,
        stableScreen,
        stableCount,
        currentScreen,
        coordsSize: coords.size,
        visitedSize: visited.size,
        hasMainRam: !!getMainRam(apple2),
    });

    return { update, debug };
}
