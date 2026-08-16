import { Apple2 } from 'js/apple2';
import { RewindBuffer } from '../emulator/snapshot/RewindBuffer';
import { restoreSnapshot } from '../emulator/snapshot/SnapshotSerializer';

/**
 * Wires a <input type="range"> to the rewind ring buffer: scrubbing pauses
 * the emulator and restores the snapshot at the selected position directly
 * (no forward-replay — simplest correct behavior for a scrub UX where
 * landing exactly on a frame boundary doesn't matter).
 *
 * Refocuses `canvas` once scrubbing ends: clicking/dragging a range input
 * naturally moves DOM focus onto it, same as clicking any button does —
 * since keyboard input is only wired to the canvas element (see
 * emulator/keyboard.ts), losing focus to the slider silently stops the
 * game from responding to the keyboard until something refocuses it. This
 * was reported via playtesting ("keyboard didn't work until I did
 * ctrl+k" — that keypress itself didn't fix anything; whatever incidental
 * click preceded it, refocusing the canvas, did).
 */
export function attachRewindScrubber(
    slider: HTMLInputElement,
    apple2: Apple2,
    buffer: RewindBuffer,
    canvas: HTMLElement,
    thumbnail: HTMLImageElement
): { syncRange: () => void } {
    let scrubbing = false;

    const showThumbnailAt = (index: number) => {
        const src = buffer.thumbnailAt(index);
        if (src) {
            thumbnail.src = src;
            thumbnail.hidden = false;
        }
    };

    slider.addEventListener('pointerdown', () => {
        if (buffer.length === 0) {
            return;
        }
        scrubbing = true;
        apple2.stop();
        showThumbnailAt(Number(slider.value));
    });

    slider.addEventListener('input', () => {
        if (!scrubbing) {
            return;
        }
        const index = Number(slider.value);
        const state = buffer.at(index);
        if (state) {
            restoreSnapshot(apple2, state);
        }
        showThumbnailAt(index);
    });

    slider.addEventListener('pointerup', () => {
        scrubbing = false;
        thumbnail.hidden = true;
        apple2.run();
        canvas.focus();
    });

    // Only touches the DOM when the buffer's length has actually changed,
    // rather than writing slider.max/value/disabled unconditionally on
    // every single frame — those writes are individually cheap, but this
    // is called from the same per-frame callback that drives audio sample
    // generation (see RewindRecorder's doc comment in RewindBuffer.ts for
    // the bigger version of this class of problem), so anything avoidably
    // running 60x/sec there is worth trimming.
    let lastSyncedLength = -1;
    const syncRange = () => {
        if (buffer.length === lastSyncedLength) {
            return;
        }
        lastSyncedLength = buffer.length;
        const max = Math.max(0, buffer.length - 1);
        slider.max = String(max);
        slider.disabled = buffer.length === 0;
        if (!scrubbing) {
            slider.value = String(max);
        }
    };

    return { syncRange };
}

/**
 * Wires a discrete "rewind N seconds" action to both a button and the
 * Backspace key (while the canvas has focus — same scoping as game input
 * itself, see emulator/keyboard.ts, so it doesn't fire while e.g. typing a
 * save name in a dialog). Jumps straight to the snapshot closest to N
 * seconds before the newest one, restores it, and refocuses the canvas
 * (see attachRewindScrubber's doc comment for why that matters).
 *
 * Backspace is also still delivered to the game as a normal keypress by
 * emulator/keyboard.ts's own canvas listener (maps to DELETE on a real
 * Apple II keyboard) — this adds the rewind action alongside that, it
 * doesn't replace it.
 */
export function attachRewindButton(
    button: HTMLButtonElement,
    apple2: Apple2,
    buffer: RewindBuffer,
    canvas: HTMLElement,
    seconds: number
): void {
    const doRewind = () => {
        const index = buffer.indexSecondsAgo(seconds);
        if (index === undefined) {
            return;
        }
        const state = buffer.at(index);
        if (!state) {
            return;
        }
        apple2.stop();
        restoreSnapshot(apple2, state);
        apple2.run();
        canvas.focus();
    };

    button.addEventListener('click', doRewind);

    canvas.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace') {
            doRewind();
        }
    });
}
