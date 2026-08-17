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
 *   display flickering between values during ordinary gameplay). Reading it
 *   via a full state snapshot's main-bank RAM (`ram[0]`, unaffected by the
 *   live softswitch state) avoids this; see readMainByte() below.
 * - GAMEEQ.S's `VisScrn` ($00CB, "469 VisScrn ds 1") is the screen
 *   currently on display — the reliable "current position" read (SCRNUM at
 *   $0023 is a scratch var CTRL.S/MOVER.S reuse for one-off per-character
 *   lookups, not a stable current-screen indicator). VisScrn lives in zero
 *   page ($0000-$01FF), which is only ever bank-switched via ALTZP
 *   ($C008/$C009), and only around rare load/save/level-transition jump
 *   points (GRAFIX.S's LOADLEVEL/SAVEGAME/etc. trampolines) — not during
 *   the per-frame render/movement/collision hot path — so a plain
 *   `cpu.read()` is fine here and stays responsive frame-to-frame.
 * - Each level's 24-screen room-link table lives in *auxiliary* RAM: EQ.S
 *   groups `blueprnt` ($b700) under its "Auxmem" heading alongside the
 *   other bulk per-level data, swapped into the //e's aux 64K bank when a
 *   level loads. `MAP` resolves to $BEA0 (96 bytes: 24 screens x 4 bytes).
 *   CTRLSUBS.S's GETLEFT/GETRIGHT/GETUP/GETDOWN (`lda MAP-4,x` / `-3,x` /
 *   `-2,x` / `-1,x` with `x = screen*4`) confirm both the byte order per
 *   screen block — [Left, Right, Above, Below] — and that screens are
 *   1-indexed with 0 meaning "no neighbor" (edge of level).
 */
const LEVEL_ADDRESS = 0x03f4;
const VISSCRN_ADDRESS = 0x00cb;
const MAP_TABLE_AUX_ADDRESS = 0xbea0;
const SCREEN_COUNT = 24;

const CELL_WIDTH_PX = 34;
const CELL_HEIGHT_PX = 24;

// Level-detection via readMainByte() is reliable but costs a full RAM
// snapshot copy, so it's throttled rather than done every tick — level
// only changes at rare transition boundaries, so a few checks a second is
// still plenty responsive.
const LEVEL_CHECK_INTERVAL_TICKS = 20;

interface LevelEntry {
    label: string;
    note?: string;
}

/**
 * Sourced directly from TOPCTRL.S's comments and level-transition logic,
 * not guessed or pulled from outside references — see the git history of
 * this file for the full reasoning per level.
 */
const LEVELS = new Map<number, LevelEntry>([
    [0, { label: 'Demo', note: 'Attract-mode loop, not a real level' }],
    [1, { label: 'Level 1', note: 'Starts without the sword' }],
    [2, { label: 'Level 2' }],
    [3, { label: 'Level 3', note: 'No separate background data in the build' }],
    [4, { label: 'Level 4' }],
    [5, { label: 'Level 5' }],
    [6, { label: 'Level 6', note: 'Falling off screen 1 cuts straight to Level 7' }],
    [7, { label: 'Level 7' }],
    [8, { label: 'Level 8' }],
    [9, { label: 'Level 9' }],
    [10, { label: 'Level 10' }],
    [11, { label: 'Level 11' }],
    [12, { label: 'Level 12', note: 'Exiting screen 23 cuts straight to Level 13' }],
    [13, { label: 'Level 13', note: 'Face the Grand Vizier Jaffar' }],
    [14, { label: 'Epilogue', note: 'Rescue the Princess' }],
]);

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

/** Reads a single byte from the main RAM bank, bypassing whatever the live RAMRD/RAMWRT softswitch state happens to be — see the file-level comment above. */
function readMainByte(apple2: Apple2, address: number): number | undefined {
    return captureSnapshot(apple2).ram?.[0]?.mem[address];
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
): { update: () => void } {
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
    emptyState.textContent = 'Builds once you’re actually in a level (not the title/attract screen).';
    container.appendChild(emptyState);

    const gridWrap = document.createElement('div');
    gridWrap.className = 'room-map-grid-wrap';
    gridWrap.hidden = true;
    container.appendChild(gridWrap);

    const grid = document.createElement('div');
    grid.className = 'room-map-grid';
    gridWrap.appendChild(grid);

    let links = new Map<number, ScreenLinks>();
    let coords = new Map<number, Coord>();
    let cells = new Map<number, HTMLDivElement>();
    let visited = new Set<number>();
    let currentScreen = 0;

    let lastLevel = -1;
    let needsRebuild = true;
    let stableScreen = -1;
    let stableCount = 0;
    let ticksSinceLevelCheck = LEVEL_CHECK_INTERVAL_TICKS; // check immediately on first tick

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
            cell.classList.toggle('room-map-hidden', !isVisited && !isFrontier);
            cell.classList.toggle('room-map-frontier', isFrontier);
            cell.classList.toggle('room-map-current', screen === currentScreen);
            cell.textContent = screen === currentScreen ? '●' : '';
        }
    };

    const rebuild = () => {
        grid.innerHTML = '';
        cells = new Map();
        visited = new Set([currentScreen]);

        const auxRam = captureSnapshot(apple2).ram?.[1]?.mem;
        links = auxRam ? readScreenLinks(auxRam) : new Map();
        coords = layoutScreens(links, currentScreen);

        emptyState.hidden = coords.size > 0;
        gridWrap.hidden = coords.size === 0;

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

    const updateLevelLine = (level: number) => {
        const entry = LEVELS.get(level);
        levelLine.textContent = entry
            ? entry.label + (entry.note ? ` — ${entry.note}` : '')
            : `Level ${level}`;
    };

    const update = () => {
        ticksSinceLevelCheck++;
        if (ticksSinceLevelCheck >= LEVEL_CHECK_INTERVAL_TICKS) {
            ticksSinceLevelCheck = 0;
            const level = readMainByte(apple2, LEVEL_ADDRESS);
            if (level !== undefined && level !== lastLevel) {
                lastLevel = level;
                updateLevelLine(level);
                needsRebuild = true;
                stableScreen = -1;
                stableCount = 0;
            }
        }

        const screen = cpu.read(VISSCRN_ADDRESS);
        stableCount = screen === stableScreen ? stableCount + 1 : 1;
        stableScreen = screen;

        if (needsRebuild) {
            // Wait for a few consecutive identical reads before trusting
            // this screen number and rebuilding from aux RAM — right after
            // a level change, the level's own load routine may still be a
            // few frames from finishing, and reading the room-link table
            // mid-load would bake in stale/partial data.
            if (screen !== 0 && stableCount >= 10) {
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

    return { update };
}
