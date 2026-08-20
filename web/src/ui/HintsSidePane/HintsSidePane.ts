import { Apple2 } from 'js/apple2';
import { SOURCE_FILE_MANIFEST } from './sourceFileManifest';
import { codeMuseumUrlForFile, CODE_MUSEUM_ROOT_URL } from '../../config/codeMuseumLinks';
import { getRecentActions, logAction, onActionLogged } from '../../emulator/ActionLog';

/**
 * Same aux-bank-bypass technique as RoomMap.ts's readAuxRam (duplicated
 * rather than imported from there to avoid coupling this file's simple
 * polling to RoomMap's much more delicate, already-hard-won level/screen
 * tracking logic — see that file's history for why it's delicate).
 */
function readAuxRam(apple2: Apple2): Uint8Array | undefined {
    return (apple2 as unknown as { ram?: Array<{ mem: Uint8Array }> }).ram?.[1]?.mem;
}

/** Resolved the same way as RoomMap.ts's LEVEL_ADDRESS/KIDSCRN_ADDRESS and CheatCodes.ts's DEVELMENT_ADDRESS. */
const LEVEL_ADDRESS = 0x03f4;
const KIDSCRN_ADDRESS = 0x005b;
const DEVELMENT_ADDRESS = 0x020e;

function formatRelativeTime(timestamp: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 5) {
        return 'just now';
    }
    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.round(seconds / 60);
    return `${minutes}m ago`;
}

interface ActionLogRow {
    item: HTMLLIElement;
    time: HTMLElement;
    label: HTMLElement;
}

function buildActionLogRow(filenames: string[]): ActionLogRow {
    const item = document.createElement('li');

    const time = document.createElement('span');
    time.className = 'action-log-time';

    const label = document.createElement('span');
    label.className = 'action-log-label';

    const links = document.createElement('span');
    links.className = 'action-log-links';
    filenames.forEach((filename, i) => {
        if (i > 0) {
            links.appendChild(document.createTextNode(' '));
        }
        const link = document.createElement('a');
        link.href = codeMuseumUrlForFile(filename);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = filename;
        links.appendChild(link);
    });

    item.appendChild(time);
    item.appendChild(label);
    item.appendChild(links);
    return { item, time, label };
}

/**
 * Updates in place (never `innerHTML = ''` + rebuild): this section
 * re-renders on every `logAction` call anywhere, which in practice means
 * many times a second while the player is actively moving between rooms.
 * A full rebuild would tear out and recreate every entry's DOM on each of
 * those — including whichever link the player currently has the mouse
 * over — which is exactly what made links impossible to click (the
 * element mousedown landed on no longer existed by the time mouseup
 * fired) and made hover underlines flicker (the browser's hover state
 * resets every time an element is torn down and a fresh one appears in
 * its place). Reusing one `<li>` per category (see ActionLog.ts's keying)
 * and only touching its text content — plus reordering via `appendChild`
 * on an *already-attached* node, which the DOM spec defines as a move,
 * not a remove+insert — means a link's element identity survives for as
 * long as its category keeps existing, so hovering or clicking it is
 * never interrupted by unrelated categories updating.
 */
function renderActionLogSection(
    listEl: HTMLElement,
    emptyEl: HTMLElement,
    rowsByCategory: Map<string, ActionLogRow>
): void {
    const actions = getRecentActions(); // newest-updated first
    // Not just `emptyEl.hidden = ...`: .hints-desc's own `display: block`
    // (an author-stylesheet rule) outranks the `[hidden]` attribute's
    // `display: none` (a lower-priority default UA-stylesheet rule), so
    // the attribute alone silently does nothing here — confirmed live,
    // the empty-state message stayed visible even with entries present.
    emptyEl.style.display = actions.length > 0 ? 'none' : '';

    const seenCategories = new Set<string>();

    for (const entry of actions) {
        seenCategories.add(entry.category);
        let row = rowsByCategory.get(entry.category);
        if (!row) {
            row = buildActionLogRow(entry.filenames);
            rowsByCategory.set(entry.category, row);
        }
        row.time.textContent = formatRelativeTime(entry.timestamp);
        row.label.textContent = entry.label;
        // Appending an element already in the document just relocates it
        // (per the DOM spec's "pre-insert" steps) — iterating newest-first
        // and appending each in turn builds that exact order without ever
        // detaching+recreating a node that didn't need to move.
        listEl.appendChild(row.item);
    }

    for (const [category, row] of rowsByCategory) {
        if (!seenCategories.has(category)) {
            row.item.remove();
            rowsByCategory.delete(category);
        }
    }
}

/**
 * Renders the source-file hints list into the given container (the "Code"
 * tab panel — see Tabs.ts). Each entry links out to its Code Museum
 * article in a new tab (see codeMuseumLinks.ts for the deep-link format).
 *
 * Also renders a "Recent actions" section above the static list — a
 * cheaper alternative to a live "what's happening right now" display
 * (which would need resolving SEQTABLE.S's animation-sequence-pointer
 * addresses to classify the character's exact current state; deferred).
 * Instead, a handful of discrete, already-cheaply-known events get logged
 * to ActionLog as they happen (fight/pick-up button, cheat codes sent —
 * see keyboard.ts/TouchControls.ts/CheatCodes.ts) plus level/room/dev-mode
 * transitions detected here via the returned `update()`, called every
 * emulator tick from main.ts like RoomMap's own handle. The player can
 * check back after the fact instead of having to watch the side pane
 * while also playing.
 */
export function renderHintsSidePane(container: HTMLElement): { update: (apple2: Apple2) => void } {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Source & hints';
    container.appendChild(heading);

    const actionLogHeading = document.createElement('p');
    actionLogHeading.className = 'cheat-section-heading';
    actionLogHeading.textContent = 'Recent actions (last 5 minutes):';
    container.appendChild(actionLogHeading);

    const actionLogEmpty = document.createElement('p');
    actionLogEmpty.className = 'hints-desc action-log-empty';
    actionLogEmpty.textContent = 'Fight, explore, or try a cheat to see relevant source links here.';
    container.appendChild(actionLogEmpty);

    const actionLogList = document.createElement('ul');
    actionLogList.className = 'action-log-list';
    container.appendChild(actionLogList);

    const actionLogRows = new Map<string, ActionLogRow>();
    renderActionLogSection(actionLogList, actionLogEmpty, actionLogRows);
    onActionLogged(() => renderActionLogSection(actionLogList, actionLogEmpty, actionLogRows));
    // Keeps "12s ago" from going stale even when nothing new gets logged.
    setInterval(() => renderActionLogSection(actionLogList, actionLogEmpty, actionLogRows), 10000);

    const rootLink = document.createElement('a');
    rootLink.href = CODE_MUSEUM_ROOT_URL;
    rootLink.target = '_blank';
    rootLink.rel = 'noopener';
    rootLink.className = 'hints-root-link';
    rootLink.textContent = 'Browse all articles on Code Museum ↗';
    container.appendChild(rootLink);

    const list = document.createElement('ul');
    list.className = 'hints-list';

    for (const entry of SOURCE_FILE_MANIFEST) {
        const item = document.createElement('li');

        const link = document.createElement('a');
        link.href = codeMuseumUrlForFile(entry.filename);
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = entry.filename;

        const desc = document.createElement('span');
        desc.className = 'hints-desc';
        desc.textContent = entry.description;

        item.appendChild(link);
        item.appendChild(desc);
        list.appendChild(item);
    }

    container.appendChild(list);

    let lastLevel: number | null = null;
    let lastScreen: number | null = null;
    let lastDevelment: number | null = null;

    // A room change only gets logged once the *new* KidScrn reading has
    // held for this many consecutive ticks. Measured live: sampling
    // KidScrn 60 times over ~2 seconds while the character wasn't moving
    // between rooms at all showed it flipping between two values 46 times
    // — real read instability, not RoomMap's already-solved RAMRD/aux-bank
    // hazard (KidScrn is zero-page, unaffected by that; level, read the
    // aux-bank-safe way, stayed rock solid in the same test). Logging on
    // every single-tick change meant `logAction('room', ...)` was firing
    // dozens of times a second, which is what was still visibly
    // flickering the text/links even after the DOM-reconciliation fix (a
    // separate, real bug) stopped it from destroying the elements.
    // Unlike RoomMap's own current-room *display* — which must react
    // immediately, since delaying it would make the map feel laggy while
    // actually walking — this is only deciding when to log a discrete
    // event, so a short, human-imperceptible debounce is safe here in a
    // way it explicitly wasn't for RoomMap (see that file's history on
    // why a stability gate broke when misapplied to KidScrn there).
    const ROOM_STABILITY_TICKS = 10;
    let pendingScreen: number | null = null;
    let pendingScreenTicks = 0;

    function update(apple2: Apple2): void {
        const cpu = apple2.getCPU();
        const level = readAuxRam(apple2)?.[LEVEL_ADDRESS];
        const screen = cpu.read(KIDSCRN_ADDRESS);
        const develment = cpu.read(DEVELMENT_ADDRESS);

        // Sanity-bound like RoomMap's own level gate: transient/garbage
        // reads (e.g. during the title/attract screen) show up as 0 or
        // 255, not a real level number.
        if (level !== undefined && level > 0 && level < 15) {
            if (lastLevel !== null && lastLevel !== level) {
                logAction('level', `Reached Level ${level}`, ['MASTER.S', 'TOPCTRL.S']);
            }
            lastLevel = level;
        }

        if (lastLevel !== null && lastLevel > 0) {
            if (screen === lastScreen) {
                pendingScreen = null;
                pendingScreenTicks = 0;
            } else if (screen === pendingScreen) {
                pendingScreenTicks++;
                if (pendingScreenTicks >= ROOM_STABILITY_TICKS) {
                    // Each category is a single de-duplicated slot (see
                    // ActionLog.ts), so even once accepted, further real
                    // room changes just refresh this one entry's
                    // timestamp instead of piling up duplicate lines.
                    logAction('room', 'Entered a new room', ['GAMEBG.S', 'BGDATA.S', 'HIRES.S']);
                    lastScreen = screen;
                    pendingScreen = null;
                    pendingScreenTicks = 0;
                }
            } else {
                pendingScreen = screen;
                pendingScreenTicks = 1;
            }
        }

        if (lastDevelment !== null && lastDevelment === 0 && develment !== 0) {
            logAction('devmode', 'Enabled dev mode (POP)', ['SPECIALK.S']);
        }
        lastDevelment = develment;
    }

    return { update };
}
