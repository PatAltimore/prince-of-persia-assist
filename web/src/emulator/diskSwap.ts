import DiskII from 'js/cards/disk2';
import Apple2IO from 'js/apple2io';
import { CPU6502 } from '@whscullin/cpu6502';

/**
 * Memory address of EQ.S's `BBundID` flag, right after `level`. Resolved
 * from build-tooling/pop-build/obj/MASTER.LST (`03F5: 00  464 BBundID ds 1`)
 * — same technique as JOYON_ADDRESS/LEVEL_ADDRESS. `POPside1`/`POPside2`
 * (SPECIALK.S) are the two values the game writes here to mean "I now
 * need side 1" / "I now need side 2" of the physical disk.
 */
const BBUNDID_ADDRESS = 0x03f5;
const POP_SIDE1 = 0xa9;
const POP_SIDE2 = 0xad;

// `type DiskSide = 1 | 2` defines a named alias for that union of literal
// types (see EmulatorController.ts's note on `1 | 2` for what that
// means). Giving it a name here means every function signature in this
// file can just say `DiskSide` instead of repeating `1 | 2` everywhere,
// and if a third disk side were ever needed, there'd be exactly one place
// to change it.
export type DiskSide = 1 | 2;

/**
 * The real POP disk driver (RW1835/RW1835.POP.S, called from MASTER.S)
 * sets `BBundID` to whichever side it's about to read from, then issues
 * an `rw18` read. On real hardware that read fails until the player
 * physically flips the disk to match; the driver's own retry loop
 * (`jsr error` / `jmp :test`, see Notes/pop-codereview-diskreads.creole)
 * just keeps trying. `error` calls into a `prompt` routine (in the RW1835
 * driver, not the main game source, so not fully traced) that shows the
 * "Insert Prince of Persia Disk" message — plausibly waiting on a
 * keypress before retrying, though that wasn't confirmed by reading the
 * source alone.
 *
 * Rather than reverse-engineer that routine fully, this watches
 * `BBundID` every tick and swaps DiskII's drive 1 content to match
 * *before* assuming anything about what the driver needs next — cheap
 * (one byte read most frames; the swap itself only happens on an actual
 * mismatch) — and, as a safety net in case the driver really is
 * key-gated, nudges a harmless keypress through afterward so a
 * keypress-wait (if there is one) doesn't get stuck. This makes physical
 * disk-flipping fully transparent to the player instead of requiring a
 * manual "swap disk" UI action.
 */
// `Record<K, V>` is a TypeScript "utility type" meaning "an object whose
// keys are all of type K, each mapped to a value of type V." Here it
// requires the caller to supply *exactly* a `1` key and a `2` key (since
// `DiskSide` is `1 | 2`), each holding a `{ name, data }` pair — a
// compile-time guarantee that both disk sides' buffers are always
// provided together, rather than e.g. an optional/partial object where
// one side could accidentally be missing.
export function attachAutoDiskSwap(
    cpu: CPU6502,
    disk2: DiskII,
    io: Apple2IO,
    initialSide: DiskSide,
    sideBuffers: Record<DiskSide, { name: string; data: ArrayBuffer }>
): { onTick: () => void; currentSide: () => DiskSide } {
    let currentSide: DiskSide = initialSide;
    // A "guard flag" / re-entrancy lock: `disk2.setBinary(...)` below is
    // asynchronous (decoding a ~230KB disk image takes a noticeable
    // fraction of a second), and `onTick` runs on every single emulated
    // frame. Without `swapping`, a swap already in progress could get
    // *started again* by the very next tick (since `currentSide` hasn't
    // been updated yet, so the mismatch that triggered the first swap
    // would still look unresolved) — `swapping` makes onTick a no-op
    // while one is already underway.
    let swapping = false;

    const onTick = () => {
        if (swapping) {
            return;
        }
        const bbundid = cpu.read(BBUNDID_ADDRESS);
        let wantedSide: DiskSide | null = null;
        if (bbundid === POP_SIDE1 && currentSide !== 1) {
            wantedSide = 1;
        } else if (bbundid === POP_SIDE2 && currentSide !== 2) {
            wantedSide = 2;
        }
        if (wantedSide === null) {
            return;
        }

        swapping = true;
        const { name, data } = sideBuffers[wantedSide];
        // `.setBinary(...)` returns a Promise; `.then(onSuccess)` schedules
        // code to run once it resolves, and `.finally(cleanup)` schedules
        // code that runs afterward *regardless* of whether it resolved or
        // rejected — the natural place to release the `swapping` lock, so
        // a failed swap doesn't leave auto-swapping permanently stuck off.
        disk2
            .setBinary(1, name, 'nib', data)
            .then(() => {
                // `wantedSide!` — the `!` again asserts "this is not
                // null," which is genuinely true here (this callback only
                // runs if the `if (wantedSide === null) return;` above
                // didn't fire) but TypeScript's control-flow analysis
                // isn't able to track that fact through the async
                // boundary into this `.then()` callback on its own.
                currentSide = wantedSide!;
                // Safety net in case the disk driver's error/retry path
                // is gated on a keypress rather than just looping — a
                // stray, functionally-inert keystroke is harmless either
                // way.
                io.keyDown(0x0d);
                io.keyUp();
            })
            .finally(() => {
                swapping = false;
            });
    };

    return { onTick, currentSide: () => currentSide };
}
