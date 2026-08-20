import { mapKeyboardEvent } from 'js/components/util/keyboard';
import { Apple2 } from 'js/apple2';

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
    return new KeyboardEvent(event.type, { key: 'Alt', location: event.location, bubbles: event.bubbles });
}

/**
 * Minimal physical-keyboard-to-Apple-II input wiring, following the same
 * pattern as apple2js's own React Keyboard component (js/components/Keyboard.tsx)
 * but without the virtual on-screen keyboard UI this app doesn't need yet.
 */
export function attachKeyboard(apple2: Apple2, target: HTMLElement): () => void {
    let capsLock = false;
    let ctrl = false;

    const keyDown = (event: KeyboardEvent) => {
        const { key, keyCode } = mapKeyboardEvent(normalizeAltGraph(event), capsLock, ctrl);

        if (key === 'CTRL') {
            ctrl = true;
        }
        if (key === 'LOCK') {
            capsLock = !capsLock;
        }

        event.preventDefault();

        if (key === 'RESET') {
            apple2.reset();
            return;
        }

        const io = apple2.getIO();
        if (key === 'OPEN_APPLE') {
            io.buttonDown(0, true);
            return;
        }
        if (key === 'CLOSED_APPLE') {
            io.buttonDown(1, true);
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

    return () => {
        target.removeEventListener('keydown', keyDown);
        target.removeEventListener('keyup', keyUp);
    };
}
