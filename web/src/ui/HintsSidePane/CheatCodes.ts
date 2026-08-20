import { Apple2 } from 'js/apple2';
import { logAction } from '../../emulator/ActionLog';

/**
 * How to actually invoke a cheat programmatically (tapping it), as opposed
 * to `keys`/`label` below which are just the human-readable reference text.
 *
 *  - `sequence`: SPECIALK.S's `checkcode` matches these against a rolling
 *    keystroke buffer, same as a real player typing the letters one at a
 *    time (see SECRET_CODES below). Dispatched via Apple2IO's own
 *    `setKeyBuffer`, which is built exactly for this: it feeds one
 *    character at a time, only advancing to the next once the game
 *    actually reads/strobes the previous one ($C010) — firing several
 *    plain `keyDown`/`keyUp` calls back-to-back instead would just
 *    overwrite the single pending keystroke apple2js models (matching
 *    real Apple II keyboard hardware) before the game ever had a chance
 *    to read it, silently losing every character but the last.
 *  - `key`: a single (optionally Ctrl-modified) keypress, dispatched as a
 *    synthetic KeyboardEvent on the canvas — the same technique already
 *    used for the on-screen joystick's Ctrl+J calibration nudge (see
 *    TouchControls.ts) — which the existing attachKeyboard wiring turns
 *    into the right ASCII/control code via mapKeyboardEvent. Also used
 *    for Shift+letter cheats: mapKeyboardEvent only cares about
 *    `event.key`, so dispatching the already-uppercase letter directly
 *    (no separate Shift press) is enough.
 */
type CheatAction = { type: 'sequence'; text: string } | { type: 'key'; key: string; ctrl?: boolean };

interface CheatCode {
    keys: string;
    label: string;
    action: CheatAction;
    /**
     * True for cheats SPECIALK.S only reads once `develment` is nonzero —
     * both `DevelKeys`'s `checkcodes` (BOOST/R/ZAP/Z/TINA — not just the
     * single-key TempDevel section) and `TempDevel` itself start with
     * `lda develment / beq ]rts`, bailing out entirely with dev mode off.
     * Tapping one of these auto-sends "POP" first if it isn't already on
     * (see invokeCheat) — same real code path as the master switch, just
     * done for you.
     */
    requiresPop?: boolean;
}

function key(k: string, ctrl = false): CheatAction {
    return { type: 'key', key: k, ctrl };
}

function sequence(text: string): CheatAction {
    return { type: 'sequence', text };
}

/**
 * "Special keys (legit)" in SPECIALK.S's LegitKeys — always active, no
 * gating, in every build of this source (DebugKeys never affected these).
 */
const ALWAYS_ACTIVE: CheatCode[] = [
    { keys: 'Esc', label: 'Freeze / single-step frame advance', action: key('Escape') },
    { keys: 'Ctrl+R', label: 'Restart to attract mode', action: key('r', true) },
    { keys: 'Ctrl+A', label: 'Abort / restart the game', action: key('a', true) },
    { keys: 'Ctrl+S', label: 'Toggle sound', action: key('s', true) },
    { keys: 'Ctrl+N', label: 'Toggle music', action: key('n', true) },
    { keys: 'Ctrl+K', label: 'Switch to keyboard control', action: key('k', true) },
    { keys: 'Ctrl+J', label: 'Switch to joystick control (recenters it)', action: key('j', true) },
    { keys: 'Ctrl+G', label: "Save game (the game's own built-in save)", action: key('g', true) },
    { keys: 'Ctrl+V', label: 'Display version number', action: key('v', true) },
    { keys: 'Space', label: 'Show remaining time', action: key(' ') },
    { keys: 'Ctrl+X', label: 'Flip screen horizontally', action: key('x', true) },
    { keys: 'Ctrl+Y', label: 'Flip screen vertically', action: key('y', true) },
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
    { keys: 'POP', label: 'Enable developer/cheat mode — required for everything below', action: sequence('POP') },
    { keys: 'SKIP', label: 'Skip ahead a level (works anytime; capped higher once POP is on)', action: sequence('SKIP') },
    { keys: 'BOOST', label: 'Max out strength (dev mode)', action: sequence('BOOST'), requiresPop: true },
    { keys: 'R', label: 'Restore / recharge the strength meter (dev mode)', action: sequence('R'), requiresPop: true },
    { keys: 'ZAP', label: 'Reduce the current guard to 0 HP (dev mode)', action: sequence('ZAP'), requiresPop: true },
    { keys: 'Z', label: 'Reduce the current guard to 1 HP (dev mode)', action: sequence('Z'), requiresPop: true },
    { keys: 'TINA', label: 'Warp straight to the ending, level 14 (dev mode)', action: sequence('TINA'), requiresPop: true },
];

/** SPECIALK.S's TempDevel — single keypresses, active once "POP" is on. */
const DEV_MODE_KEYS: CheatCode[] = [
    { keys: 'Ctrl+Q', label: 'Antimatter (temporary invincibility)', action: key('q', true), requiresPop: true },
    { keys: 'Shift+S', label: 'Increase strength', action: key('S'), requiresPop: true },
    { keys: 'Shift+D', label: 'Decrease strength', action: key('D'), requiresPop: true },
    { keys: 'Shift+F', label: 'Increase max strength', action: key('F'), requiresPop: true },
    { keys: ')', label: 'Skip to the next level', action: key(')'), requiresPop: true },
    { keys: '+', label: 'Skip ahead 5 levels', action: key('+'), requiresPop: true },
    { keys: 'Ctrl+E', label: 'Move up one block', action: key('e', true), requiresPop: true },
    { keys: 'Shift+A', label: 'Toggle auto-play', action: key('A'), requiresPop: true },
    { keys: '<', label: 'Rewind the in-game clock', action: key('<'), requiresPop: true },
    { keys: '>', label: 'Advance the in-game clock', action: key('>'), requiresPop: true },
    { keys: 'Shift+M', label: 'Set time remaining to max', action: key('M'), requiresPop: true },
    { keys: '*', label: 'Erase saved game', action: key('*'), requiresPop: true },
    { keys: 'Ctrl+C', label: 'Reload the current level', action: key('c', true), requiresPop: true },
    { keys: 'Ctrl+Z', label: 'Reboot', action: key('z', true), requiresPop: true },
    { keys: 'Ctrl+F', label: 'Force a screen redraw', action: key('f', true), requiresPop: true },
    { keys: 'Shift+B', label: 'Toggle blackout', action: key('B'), requiresPop: true },
    { keys: ']', label: 'Speed up the game loop', action: key(']'), requiresPop: true },
    { keys: '[', label: 'Slow down the game loop', action: key('['), requiresPop: true },
    { keys: '@', label: 'Screen dump', action: key('@'), requiresPop: true },
];

/**
 * SPECIALK.S's `develment` flag (see checkcodes above). Resolved from
 * build-tooling/pop-build/obj/AUTO.LST (`020E: 00  446 develment ds 1`) —
 * same technique as JOYON_ADDRESS/LEVEL_ADDRESS elsewhere in this app.
 * Confirmed live: reads 0 before "POP" is typed, 1 immediately after.
 */
const DEVELMENT_ADDRESS = 0x020e;

function dispatchKeyAction(canvas: HTMLCanvasElement, action: { type: 'key'; key: string; ctrl?: boolean }): void {
    const opts = { bubbles: true } as const;
    if (action.ctrl) {
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...opts }));
    }
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: action.key, ...opts }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: action.key, ...opts }));
    if (action.ctrl) {
        canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ...opts }));
    }
}

/**
 * Polls `develment` until the game actually flips it on (or `timeoutMs`
 * elapses as a safety net). `setKeyBuffer`'s characters are only consumed
 * as the game's own keyboard-strobe read pulls each one — see the
 * `sequence` case's doc comment above — so "POP" typically takes a few
 * frames, not one tick, to fully register.
 */
function waitForDevelMode(apple2: Apple2, timeoutMs = 1500): Promise<void> {
    return new Promise((resolve) => {
        const cpu = apple2.getCPU();
        const deadline = Date.now() + timeoutMs;
        function poll() {
            if (cpu.read(DEVELMENT_ADDRESS) !== 0 || Date.now() > deadline) {
                resolve();
                return;
            }
            setTimeout(poll, 50);
        }
        poll();
    });
}

// Shared across every trigger so two POP-requiring cheats tapped in quick
// succession (before the first "POP" has finished being typed) await the
// same in-flight injection instead of each restarting setKeyBuffer's
// character queue and corrupting one another's sequence.
let popInjectionPromise: Promise<void> | null = null;

function ensurePopActive(apple2: Apple2): Promise<void> {
    if (apple2.getCPU().read(DEVELMENT_ADDRESS) !== 0) {
        return Promise.resolve();
    }
    if (!popInjectionPromise) {
        apple2.getIO().setKeyBuffer('POP');
        popInjectionPromise = waitForDevelMode(apple2).finally(() => {
            popInjectionPromise = null;
        });
    }
    return popInjectionPromise;
}

async function invokeCheat(apple2: Apple2, canvas: HTMLCanvasElement, cheat: CheatCode): Promise<void> {
    let autoEnabledPop = false;
    if (cheat.requiresPop) {
        autoEnabledPop = apple2.getCPU().read(DEVELMENT_ADDRESS) === 0;
        await ensurePopActive(apple2);
    }
    const { action } = cheat;
    if (action.type === 'sequence') {
        apple2.getIO().setKeyBuffer(action.text);
    } else {
        dispatchKeyAction(canvas, action);
    }
    canvas.focus();
    logAction(
        `cheat:${cheat.keys}`,
        `Sent cheat "${cheat.keys}"${autoEnabledPop ? ' (auto-enabled POP first)' : ''}`,
        ['SPECIALK.S']
    );
}

function buildList(codes: CheatCode[], className: string, apple2: Apple2, canvas: HTMLCanvasElement): HTMLUListElement {
    const list = document.createElement('ul');
    list.className = className;
    for (const cheat of codes) {
        const { keys, label } = cheat;
        const item = document.createElement('li');
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cheat-trigger';
        trigger.setAttribute('aria-label', `Send ${keys}: ${label}`);
        const kbd = document.createElement('kbd');
        kbd.textContent = keys;
        const desc = document.createElement('span');
        desc.textContent = label;
        trigger.appendChild(kbd);
        trigger.appendChild(desc);
        trigger.addEventListener('click', () => {
            void invokeCheat(apple2, canvas, cheat).then(() => {
                trigger.classList.remove('cheat-trigger-sent');
                // Force a reflow so re-adding the class restarts the CSS
                // animation even if the same cheat is tapped again quickly.
                void trigger.offsetWidth;
                trigger.classList.add('cheat-trigger-sent');
            });
        });
        trigger.addEventListener('animationend', () => {
            trigger.classList.remove('cheat-trigger-sent');
        });
        item.appendChild(trigger);
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
 *
 * Every entry is also a tap/click target that sends the real key sequence
 * to the emulator (see invokeCheat above) — typing multi-letter codes on a
 * phone with no physical keyboard is impractical otherwise.
 */
export function renderCheatCodes(container: HTMLElement, apple2: Apple2, canvas: HTMLCanvasElement): void {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Cheat codes (SPECIALK.S)';
    container.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'cheat-intro';
    intro.textContent = "Jordan Mechner's own debug/cheat key bindings from the source. All of these are active in this build (DebugKeys=1). Tap any entry to send it to the game — dev-mode-only cheats send POP first automatically if it isn't already active.";
    container.appendChild(intro);

    container.appendChild(buildList(ALWAYS_ACTIVE, 'cheat-list', apple2, canvas));

    addSectionHeading(container, 'Type these letter sequences (no modifier keys):');
    container.appendChild(buildList(SECRET_CODES, 'cheat-list', apple2, canvas));

    addSectionHeading(container, 'Single-key cheats, dev mode (POP sent automatically if needed):');
    container.appendChild(buildList(DEV_MODE_KEYS, 'cheat-list', apple2, canvas));
}
