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
export function attachAutoDiskSwap(
    cpu: CPU6502,
    disk2: DiskII,
    io: Apple2IO,
    initialSide: DiskSide,
    sideBuffers: Record<DiskSide, { name: string; data: ArrayBuffer }>
): { onTick: () => void; currentSide: () => DiskSide } {
    let currentSide: DiskSide = initialSide;
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
        disk2
            .setBinary(1, name, 'nib', data)
            .then(() => {
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
