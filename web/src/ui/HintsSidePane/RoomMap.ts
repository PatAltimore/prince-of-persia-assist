import { Apple2 } from 'js/apple2';
import { captureSnapshot } from '../../emulator/snapshot/SnapshotSerializer';

/**
 * Memory addresses resolved from build-tooling/pop-build/obj/MASTER.LST,
 * same technique as EmulatorController.ts's JOYON_ADDRESS.
 *
 * - EQ.S's `level` flag ($03F4: "463 level ds 1") is used below purely as
 *   a *change trigger* ("something happened, try a rebuild"), never
 *   compared against a specific value to decide whether to show or hide
 *   the map — deliberately, since `level` lives in the $0200-$BFFF range,
 *   which HIRES.S's rendering code flips between main and aux RAM (via the
 *   RAMRD softswitch, $C002/$C003) *many times per frame* while drawing
 *   the screen. That's frequent enough that a plain `cpu.read()` doesn't
 *   just occasionally glitch — in practice, every misread re-triggers the
 *   "wait for the level to settle" gate below, which blocks live
 *   screen-tracking for another LEVEL_LOAD_SETTLE_TICKS ticks each time,
 *   even though a perfectly good map is already built. So `level` is read
 *   via readMainByte() (bypassing whatever the live softswitch state
 *   happens to be) instead of cpu.read() — cheap enough to do every tick
 *   since it's a single byte, not a full apple2.getState() snapshot. The
 *   actual graph is always built from KidScrn (see below), never from
 *   `level` itself, so this only needs to be *reasonably* stable, not
 *   perfectly so — but "reasonably" still means "not glitching essentially
 *   every frame."
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
 *   (potion) = 10`, `exit = 16` — confirmed as the actual level-exit
 *   staircase via its handlers (MOVER.S's `openexit`/`animexit`,
 *   FRAMEADV.S's `drawexitb`). BGDATA.S also defines `exit2 = 17`, but
 *   grepping the whole source tree turns up no `cmp #exit2` anywhere — it's
 *   unused, so it's deliberately not treated as a second exit ID here.
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

// How many ticks to wait after a level change before trusting KidScrn and
// rebuilding the map from aux RAM — the level's own load routine may still
// be a few frames from finishing when `level` itself changes, and reading
// the room-link table mid-load would bake in stale/partial data. This is a
// flat delay, not a "wait for KidScrn to stop changing" gate: a real
// player may already be walking away from the spawn point well within
// this window, and KidScrn changing is expected, not a sign the read is
// untrustworthy (see the file-level comment on KidScrn vs VisScrn).
const LEVEL_LOAD_SETTLE_TICKS = 10;

/**
 * Reads a single byte straight from the main RAM bank's live backing
 * array, bypassing whatever the live RAMRD/RAMWRT softswitch state
 * happens to be (see the file-level comment on `level`) — and bypassing
 * the cost of `apple2.getState()`, which besides copying both 48KB RAM
 * banks also serializes CPU/video/IO/MMU state this doesn't need, so it's
 * cheap enough to call every tick.
 *
 * `ram` is a private field on Apple2 (js/apple2.ts), not part of its
 * public API — this project already reaches into it directly elsewhere
 * for the same reason (see docs/SPIKE-NOTES.md's
 * `apple2.ram[0].mem.buffer` check), and the field itself is part of a
 * pinned vendored dependency (web/vendor/apple2js), so this is a
 * deliberate, documented exception rather than an accident.
 */
function readMainByte(apple2: Apple2, address: number): number | undefined {
    return (apple2 as unknown as { ram?: Array<{ mem: Uint8Array }> }).ram?.[0]?.mem[address];
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

const IMPORTANT_LABELS: Record<ImportantKind, string> = {
    sword: 'sword',
    potion: 'potion',
    exit: 'exit',
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
    let pendingLevel = 0;
    let needsRebuild = true;
    let ticksSinceLevelChange = 0;

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

    const update = () => {
        // `level` is read purely to notice "something changed, worth a
        // rebuild attempt" — never compared against a specific value (see
        // the file-level comment). The rebuild itself is keyed off
        // KidScrn, which is what actually decides whether real map data
        // exists to show.
        const level = readMainByte(apple2, LEVEL_ADDRESS);
        if (level !== undefined && level !== lastLevel) {
            lastLevel = level;
            pendingLevel = level;
            needsRebuild = true;
            ticksSinceLevelChange = 0;
        }

        const screen = cpu.read(KIDSCRN_ADDRESS);

        if (needsRebuild) {
            ticksSinceLevelChange++;
            if (screen !== 0 && ticksSinceLevelChange >= LEVEL_LOAD_SETTLE_TICKS) {
                currentScreen = screen;
                needsRebuild = false;
                rebuild();
            }
            return;
        }

        if (screen !== 0 && screen !== currentScreen && coords.has(screen)) {
            currentScreen = screen;
            visited.add(screen);
            renderVisibility();
        }
    };

    const debug = () => ({
        lastLevel,
        pendingLevel,
        needsRebuild,
        ticksSinceLevelChange,
        currentScreen,
        coordsSize: coords.size,
        visitedSize: visited.size,
    });

    return { update, debug };
}
