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

function renderActionLogSection(listEl: HTMLElement, emptyEl: HTMLElement): void {
    const actions = getRecentActions().reverse(); // newest first
    listEl.innerHTML = '';
    // Not just `emptyEl.hidden = ...`: .hints-desc's own `display: block`
    // (an author-stylesheet rule) outranks the `[hidden]` attribute's
    // `display: none` (a lower-priority default UA-stylesheet rule), so
    // the attribute alone silently does nothing here — confirmed live,
    // the empty-state message stayed visible even with entries present.
    emptyEl.style.display = actions.length > 0 ? 'none' : '';

    for (const entry of actions) {
        const item = document.createElement('li');

        const time = document.createElement('span');
        time.className = 'action-log-time';
        time.textContent = formatRelativeTime(entry.timestamp);

        const label = document.createElement('span');
        label.className = 'action-log-label';
        label.textContent = entry.label;

        const links = document.createElement('span');
        links.className = 'action-log-links';
        entry.filenames.forEach((filename, i) => {
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
        listEl.appendChild(item);
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

    renderActionLogSection(actionLogList, actionLogEmpty);
    onActionLogged(() => renderActionLogSection(actionLogList, actionLogEmpty));
    // Keeps "12s ago" from going stale even when nothing new gets logged.
    setInterval(() => renderActionLogSection(actionLogList, actionLogEmpty), 10000);

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
    let lastLevelLogTime = 0;
    let lastRoomLogTime = 0;
    // POP's own attract-mode demo (AUTO.S) auto-plays a scripted run
    // through real gameplay using these same `level`/KidScrn variables —
    // confirmed live: sitting at the title screen produced a burst of
    // "Entered a new room" entries in rapid succession, one per demo
    // screen transition, because the simple `level > 0` sanity bound
    // below can't tell a scripted demo apart from a real player (the same
    // ambiguity RoomMap's own UI already documents as a known caveat
    // rather than fully solving — see its "not the title/attract screen"
    // copy). Rather than chase a perfect detector, a short cooldown just
    // caps how often either event can log, coalescing a burst into one
    // entry regardless of what's actually causing it.
    const LOG_COOLDOWN_MS = 4000;

    function update(apple2: Apple2): void {
        const cpu = apple2.getCPU();
        const level = readAuxRam(apple2)?.[LEVEL_ADDRESS];
        const screen = cpu.read(KIDSCRN_ADDRESS);
        const develment = cpu.read(DEVELMENT_ADDRESS);
        const now = Date.now();

        // Sanity-bound like RoomMap's own level gate: transient/garbage
        // reads (e.g. during the title/attract screen) show up as 0 or
        // 255, not a real level number.
        if (level !== undefined && level > 0 && level < 15) {
            if (lastLevel !== null && lastLevel !== level && now - lastLevelLogTime > LOG_COOLDOWN_MS) {
                logAction(`Reached Level ${level}`, ['MASTER.S', 'TOPCTRL.S']);
                lastLevelLogTime = now;
            }
            lastLevel = level;
        }

        if (lastLevel !== null && lastLevel > 0) {
            if (lastScreen !== null && lastScreen !== screen && now - lastRoomLogTime > LOG_COOLDOWN_MS) {
                logAction('Entered a new room', ['GAMEBG.S', 'BGDATA.S', 'HIRES.S']);
                lastRoomLogTime = now;
            }
            lastScreen = screen;
        }

        if (lastDevelment !== null && lastDevelment === 0 && develment !== 0) {
            logAction('Enabled dev mode (POP)', ['SPECIALK.S']);
        }
        lastDevelment = develment;
    }

    return { update };
}
