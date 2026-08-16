interface CheatCode {
    keys: string;
    label: string;
}

/**
 * "Special keys (legit)" in SPECIALK.S's LegitKeys — always active, no
 * gating, in every build of this source (DebugKeys never affected these).
 */
const ALWAYS_ACTIVE: CheatCode[] = [
    { keys: 'Esc', label: 'Freeze / single-step frame advance' },
    { keys: 'Ctrl+R', label: 'Restart to attract mode' },
    { keys: 'Ctrl+A', label: 'Abort / restart the game' },
    { keys: 'Ctrl+S', label: 'Toggle sound' },
    { keys: 'Ctrl+N', label: 'Toggle music' },
    { keys: 'Ctrl+K', label: 'Switch to keyboard control' },
    { keys: 'Ctrl+J', label: 'Switch to joystick control (recenters it)' },
    { keys: 'Ctrl+G', label: "Save game (the game's own built-in save)" },
    { keys: 'Ctrl+V', label: 'Display version number' },
    { keys: 'Space', label: 'Show remaining time' },
    { keys: 'Ctrl+X', label: 'Flip screen horizontally' },
    { keys: 'Ctrl+Y', label: 'Flip screen vertically' },
];

/**
 * Type these letters in sequence (no modifier keys) — checked against a
 * rolling keystroke buffer by SPECIALK.S's `checkcode`, same mechanism as
 * a classic text adventure parser, not a single keypress. "POP" is the
 * master switch: everything below it, and every key in DEV_MODE_KEYS,
 * only does something once "POP" has been typed. "SKIP" is the one
 * exception — it's unconditional (see the `do FinalDisk` guard around it
 * in KEYS), just more powerful once dev mode is on (capped at level 4
 * normally, level 12 once "POP" is active).
 */
const SECRET_CODES: CheatCode[] = [
    { keys: 'POP', label: 'Enable developer/cheat mode — required for everything below' },
    { keys: 'SKIP', label: 'Skip ahead a level (works anytime; capped higher once POP is on)' },
    { keys: 'BOOST', label: 'Max out strength (dev mode)' },
    { keys: 'R', label: 'Restore / recharge the strength meter (dev mode)' },
    { keys: 'ZAP', label: 'Reduce the current guard to 0 HP (dev mode)' },
    { keys: 'Z', label: 'Reduce the current guard to 1 HP (dev mode)' },
    { keys: 'TINA', label: 'Warp straight to the ending, level 14 (dev mode)' },
];

/** SPECIALK.S's TempDevel — single keypresses, active once "POP" is on. */
const DEV_MODE_KEYS: CheatCode[] = [
    { keys: 'Ctrl+Q', label: 'Antimatter (temporary invincibility)' },
    { keys: 'Shift+S', label: 'Increase strength' },
    { keys: 'Shift+D', label: 'Decrease strength' },
    { keys: 'Shift+F', label: 'Increase max strength' },
    { keys: ')', label: 'Skip to the next level' },
    { keys: '+', label: 'Skip ahead 5 levels' },
    { keys: 'Ctrl+E', label: 'Move up one block' },
    { keys: 'Shift+A', label: 'Toggle auto-play' },
    { keys: '< / >', label: 'Rewind / advance the in-game clock' },
    { keys: 'Shift+M', label: 'Set time remaining to max' },
    { keys: '*', label: 'Erase saved game' },
    { keys: 'Ctrl+C', label: 'Reload the current level' },
    { keys: 'Ctrl+Z', label: 'Reboot' },
    { keys: 'Ctrl+F', label: 'Force a screen redraw' },
    { keys: 'Shift+B', label: 'Toggle blackout' },
    { keys: '] / [', label: 'Speed up / slow down the game loop' },
    { keys: '@', label: 'Screen dump' },
];

function buildList(codes: CheatCode[], className: string): HTMLUListElement {
    const list = document.createElement('ul');
    list.className = className;
    for (const { keys, label } of codes) {
        const item = document.createElement('li');
        const kbd = document.createElement('kbd');
        kbd.textContent = keys;
        const desc = document.createElement('span');
        desc.textContent = label;
        item.appendChild(kbd);
        item.appendChild(desc);
        list.appendChild(item);
    }
    return list;
}

function addSectionHeading(container: HTMLElement, text: string): void {
    const h = document.createElement('p');
    h.className = 'cheat-section-heading';
    h.textContent = text;
    container.appendChild(h);
}

/**
 * Renders the cheat-code reference into `container` (the "Cheats" tab
 * panel — see Tabs.ts), sourced directly from SPECIALK.S. This build has
 * DebugKeys=1 (see docs/DECISIONS.md and docs/SPIKE-NOTES.md for why,
 * versus the original release's DebugKeys=0), so all of this — not just
 * the always-on utility keys — is genuinely active.
 */
export function renderCheatCodes(container: HTMLElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Cheat codes (SPECIALK.S)';
    container.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'cheat-intro';
    intro.textContent = "Jordan Mechner's own debug/cheat key bindings from the source. All of these are active in this build (DebugKeys=1).";
    container.appendChild(intro);

    container.appendChild(buildList(ALWAYS_ACTIVE, 'cheat-list'));

    addSectionHeading(container, 'Type these letter sequences (no modifier keys):');
    container.appendChild(buildList(SECRET_CODES, 'cheat-list'));

    addSectionHeading(container, 'Single-key cheats, active once "POP" has been typed:');
    container.appendChild(buildList(DEV_MODE_KEYS, 'cheat-list'));
}
