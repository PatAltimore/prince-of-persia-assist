import { mapKeyboardEvent } from 'js/components/util/keyboard';
import { Apple2 } from 'js/apple2';

/**
 * Minimal physical-keyboard-to-Apple-II input wiring, following the same
 * pattern as apple2js's own React Keyboard component (js/components/Keyboard.tsx)
 * but without the virtual on-screen keyboard UI this app doesn't need yet.
 */
export function attachKeyboard(apple2: Apple2, target: HTMLElement): () => void {
    let capsLock = false;
    let ctrl = false;

    const keyDown = (event: KeyboardEvent) => {
        const { key, keyCode } = mapKeyboardEvent(event, capsLock, ctrl);

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
        const { key } = mapKeyboardEvent(event);

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
