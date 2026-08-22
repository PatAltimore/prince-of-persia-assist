import { mapKeyboardEvent } from 'js/components/util/keyboard';
import { Apple2 } from 'js/apple2';
import { logAction } from './ActionLog';

/**
 * Some Android/Fire-OS browsers (confirmed report: Kindle Fire's Silk
 * browser with a Bluetooth keyboard) send `event.key === 'AltGraph'` for
 * the right-hand Alt key instead of `'Alt'` — a real, distinct value per
 * the UI Events spec, not a bug in the browser, but apple2js's
 * `mapKeyboardEvent` (vendored — not ours to patch) only ever checks for
 * the literal string `'Alt'`. Left unhandled, `'AltGraph'` falls through
 * every branch: not a special key, not length-1, matches neither
 * OPEN_APPLE nor CLOSED_APPLE — so the keypress silently does nothing at
 * all, which is exactly "Alt doesn't pick up the sword." Re-presenting it
 * as a synthetic `'Alt'` event (preserving `location`, since that's what
 * picks OPEN_APPLE vs CLOSED_APPLE) fixes it without touching the
 * vendored library.
 */
function normalizeAltGraph(event: KeyboardEvent): KeyboardEvent {
    if (event.key !== 'AltGraph') {
        return event;
    }
    // `KeyboardEvent` properties like `.key` are read-only — you can't
    // just write `event.key = 'Alt'` on the original event — so fixing up
    // a "wrong" value means constructing a brand new event object instead
    // and using that from here on. `new KeyboardEvent(type, options)`
    // takes the event's type ('keydown'/'keyup', copied from the
    // original via `event.type`) plus an options object for the
    // properties that matter to the code reading it downstream.
    return new KeyboardEvent(event.type, { key: 'Alt', location: event.location, bubbles: event.bubbles });
}

/**
 * Minimal physical-keyboard-to-Apple-II input wiring, following the same
 * pattern as apple2js's own React Keyboard component (js/components/Keyboard.tsx)
 * but without the virtual on-screen keyboard UI this app doesn't need yet.
 */
export function attachKeyboard(apple2: Apple2, target: HTMLElement): () => void {
    // `capsLock`/`ctrl` are private state that only `keyDown`/`keyUp`
    // (defined below, inside this same function call) ever touch — a
    // closure, per this codebase's shared convention (see main.ts's
    // top-of-file note). Each call to `attachKeyboard` gets its own
    // independent pair of these variables; there's no way for outside
    // code to read or accidentally overwrite them except through the
    // functions defined here.
    let capsLock = false;
    let ctrl = false;

    // Real physical keyboards don't have "Open Apple"/"Closed Apple" keys
    // (the Apple //e did, next to the spacebar — apple2js's own
    // conventional names for the two paddle buttons); this app follows
    // the common Apple II emulator convention of mapping the left/right
    // Alt keys to them instead, distinguished by `event.location`
    // (`mapKeyboardEvent`'s job — see the KeyboardEvent-key vs -location
    // distinction called out where this app resolves that mapping).
    const keyDown = (event: KeyboardEvent) => {
        const { key, keyCode } = mapKeyboardEvent(normalizeAltGraph(event), capsLock, ctrl);

        if (key === 'CTRL') {
            ctrl = true;
        }
        if (key === 'LOCK') {
            capsLock = !capsLock;
        }

        // Without this, the browser's own default behavior for some keys
        // (Backspace navigating back a page, Tab moving focus, etc.)
        // would fire *in addition to* whatever this app does with the
        // key — `preventDefault()` tells the browser "I'm handling this
        // key myself, don't also do your usual thing with it."
        event.preventDefault();

        if (key === 'RESET') {
            apple2.reset();
            return;
        }

        const io = apple2.getIO();
        if (key === 'OPEN_APPLE' || key === 'CLOSED_APPLE') {
            io.buttonDown(key === 'OPEN_APPLE' ? 0 : 1, true);
            // `event.repeat` is true for the auto-repeated keydown events
            // a browser fires while a key is held down (after the initial
            // press, roughly the same as how a held key spams characters
            // into a text box) — checking `!event.repeat` here means this
            // only logs once per actual press, not dozens of times while
            // the player holds the key down.
            if (!event.repeat) {
                logAction('fight', 'Fight / draw sword / pick up', ['CTRL.S', 'CTRLSUBS.S']);
            }
            return;
        }

        if (keyCode !== 0xff) {
            io.keyDown(keyCode);
        }
    };

    const keyUp = (event: KeyboardEvent) => {
        const { key } = mapKeyboardEvent(normalizeAltGraph(event));

        if (key === 'CTRL') {
            ctrl = false;
        }

        const io = apple2.getIO();
        if (key === 'OPEN_APPLE') {
            io.buttonDown(0, false);
        }
        if (key === 'CLOSED_APPLE') {
            io.buttonDown(1, false);
        }
        io.keyUp();
    };

    target.addEventListener('keydown', keyDown);
    target.addEventListener('keyup', keyUp);

    // Returning a "cleanup function" — one that undoes exactly what this
    // function just set up — is a common pattern for anything that
    // registers a listener/subscription: whoever calls `attachKeyboard`
    // gets back a single function they can call later to detach these
    // same two listeners, without needing to remember what was attached
    // or keep the `keyDown`/`keyUp` references around themselves.
    return () => {
        target.removeEventListener('keydown', keyDown);
        target.removeEventListener('keyup', keyUp);
    };
}
