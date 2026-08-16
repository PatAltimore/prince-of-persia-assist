import { Apple2 } from 'js/apple2';
import { captureSnapshot } from '../../emulator/snapshot/SnapshotSerializer';
import { LEVEL_ADDRESS } from './LevelMap';

/**
 * Memory addresses resolved from build-tooling/pop-build/obj/MASTER.LST,
 * same technique as LEVEL_ADDRESS.
 *
 * - GAMEEQ.S's `VisScrn` ($00CB, main zero page — "00CB: 00  469 VisScrn ds
 *   1") is the screen currently on display. `SCRNUM` ($0023) also exists
 *   but CTRL.S/MOVER.S use it as a scratch parameter for one-off
 *   per-character screen lookups, not a stable "current position" — VisScrn
 *   is the one the game itself treats as *the* visible screen (used
 *   throughout COLL.S/MOVER.S/SUBS.S for rendering and collision), so it's
 *   the reliable read here.
 * - Each level's 24-screen room-link table lives in *auxiliary* RAM, not
 *   main memory: EQ.S groups `blueprnt` ($b700) under its "Auxmem" heading
 *   alongside the other bulk per-level data (`BLUETYPE`/`BLUESPEC`/
 *   `LINKLOC`/`LINKMAP`/`MAP`/`INFO`), all swapped into the //e's aux 64K
 *   bank when a level loads. `MAP` itself resolves to $BEA0 (96 bytes: 24
 *   screens x 4 bytes). CTRLSUBS.S's GETLEFT/GETRIGHT/GETUP/GETDOWN
 *   (`lda MAP-4,x` / `-3,x` / `-2,x` / `-1,x` with `x = screen*4`) confirm
 *   both the byte order per screen block — [Left, Right, Above, Below] —
 *   and that screens are 1-indexed with 0 meaning "no neighbor" (edge of
 *   level).
 */
const VISSCRN_ADDRESS = 0x00cb;
const MAP_TABLE_AUX_ADDRESS = 0xbea0;
const SCREEN_COUNT = 24;

const CELL_WIDTH_PX = 34;
const CELL_HEIGHT_PX = 24;

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
 * Renders a fog-of-war map of the current level's screens into `container`
 * (appended alongside, not replacing, whatever's already there — see
 * LevelMap.ts's `renderLevelMap`, mounted into the same tab panel).
 *
 * The screen graph and grid layout are rebuilt once per level (from the
 * aux-RAM room-link table); after that, per-tick `update()` just tracks
 * which screen is current and adds it to the revealed set — cheap, same
 * pattern as LevelMap.ts's own update().
 */
export function renderRoomMap(
    container: HTMLElement,
    apple2: Apple2
): { update: () => void } {
    const cpu = apple2.getCPU();

    const section = document.createElement('div');
    section.className = 'room-map-section';
    container.appendChild(section);

    const heading = document.createElement('h2');
    heading.textContent = 'Room map';
    section.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'cheat-intro';
    intro.textContent =
        "Fog-of-war map of the current level's screens, built from the level's own room-link data and revealed as you explore.";
    section.appendChild(intro);

    const gridWrap = document.createElement('div');
    gridWrap.className = 'room-map-grid-wrap';
    section.appendChild(gridWrap);

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
            cell.textContent = isVisited ? String(screen) : '';
        }
    };

    const rebuild = () => {
        grid.innerHTML = '';
        cells = new Map();
        visited = new Set([currentScreen]);

        const auxRam = captureSnapshot(apple2).ram?.[1]?.mem;
        links = auxRam ? readScreenLinks(auxRam) : new Map();
        coords = layoutScreens(links, currentScreen);

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
        const level = cpu.read(LEVEL_ADDRESS);
        if (level !== lastLevel) {
            lastLevel = level;
            needsRebuild = true;
            stableScreen = -1;
            stableCount = 0;
        }

        const screen = cpu.read(VISSCRN_ADDRESS);
        stableCount = screen === stableScreen ? stableCount + 1 : 1;
        stableScreen = screen;

        if (needsRebuild) {
            // Wait for a few consecutive identical reads before trusting
            // this screen number and rebuilding from aux RAM — right after
            // the level byte changes, the level's own load routine may
            // still be a few frames from finishing, and reading the
            // room-link table mid-load would bake in stale/partial data.
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
