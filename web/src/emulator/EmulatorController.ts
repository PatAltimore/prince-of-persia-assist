import DiskII from 'js/cards/disk2';
import SmartPort from 'js/cards/smartport';
import { Apple2 } from 'js/apple2';
import { Audio } from 'js/ui/audio';
import { CPU6502 } from '@whscullin/cpu6502';
import { BLOCK_FORMATS, FLOPPY_FORMATS } from 'js/formats/types';
import { includes } from 'js/types';

/**
 * Memory address of SPECIALK.S's `joyon` flag (`0` = keyboard input,
 * nonzero = joystick input — see the `ksetkbd`/`ksetjstk` key handlers in
 * that file, bound to Ctrl+K/Ctrl+J). Resolved from
 * build-tooling/pop-build/obj/SPECIALK.LST after the Phase 0 assembly
 * (`020D: 00  445 joyon ds 1`, and `sta joyon` assembles to `8D 0D 02`,
 * i.e. `STA $020D`). This is specific to the exact assembled binary
 * shipped in web/public/disks/ — if that disk image is ever rebuilt from
 * source, re-check this address against the regenerated .LST file.
 */
const JOYON_ADDRESS = 0x020d;

export interface EmulatorHandles {
    apple2: Apple2;
    disk2: DiskII;
    smartport: SmartPort;
    cpu: CPU6502;
    audio: Audio;
}

/**
 * Boots the Apple II system and wires up the minimal set of cards Prince of
 * Persia needs (disk controller, smartport for potential .hdv use).
 *
 * System profile: Enhanced Apple //e, 128K (`e: true, enhanced: true`,
 * `apple2enh`/`apple2enh_char` ROMs) — matching apple2js's own default
 * system profile (js/components/util/systems.ts, `defaultSystem`) and the
 * wiring in its js/main2e.ts entry point. POP's BOOT.S does an explicit
 * 128K memory check and refuses to run ("requires a //c or //e with 128K")
 * on a plain Apple II / II+ profile, which is what an earlier version of
 * this file used (copied from apple2js's *other* legacy entry, js/main2.ts,
 * which targets a plain II) — that's why boot failed with that message.
 * No language card is wired here (unlike main2.ts's plain-II wiring):
 * the //e's own MMU provides 128K of bank-switched RAM natively, and
 * main2e.ts doesn't use one either.
 */
export async function bootEmulator(
    canvas: HTMLCanvasElement,
    tick: () => void
): Promise<EmulatorHandles> {
    const apple2 = new Apple2({
        canvas,
        gl: false,
        rom: 'apple2enh',
        characterRom: 'apple2enh_char',
        e: true,
        enhanced: true,
        tick,
    });

    await apple2.ready;

    const cpu = apple2.getCPU();
    const io = apple2.getIO();

    // apple2js's Apple2IO initializes all four simulated paddles to 0.0 —
    // the extreme low end of its 0.0-1.0 range (0.5 is center; see
    // js/ui/gamepad.ts's own math: `(axes[0] * 1.414 + 1) / 2.0`, which
    // yields 0.5 for a centered real joystick axis). With no real gamepad
    // connected, that reading never changes. POP reads the joystick for
    // movement (see CTRLSUBS.S), so an uncentered paddle 0 reads as a
    // permanently-pushed-left stick — the prince walks into the left wall
    // and never responds to keyboard input, because the game is (correctly,
    // from its perspective) following what it thinks is a held joystick.
    // Centering all four here fixes it without needing a real gamepad.
    io.paddle(0, 0.5);
    io.paddle(1, 0.5);
    io.paddle(2, 0.5);
    io.paddle(3, 0.5);

    // apple2js's DiskII card unconditionally tries to spin up a Web Worker
    // at a hardcoded webpack-specific path ('dist/format_worker.bundle.js')
    // that doesn't exist in this Vite build. Hiding window.Worker for the
    // duration of construction makes it fall back to its synchronous
    // disk-decoding path instead, which works fine for our purposes.
    const originalWorker = window.Worker;
    // @ts-expect-error -- see comment above
    window.Worker = undefined;
    const disk2 = new DiskII(io, {
        driveLight: () => {
            /* wired up by GameCanvas/status UI */
        },
        label: () => {
            /* wired up by GameCanvas/status UI */
        },
        dirty: () => {
            /* no-op: no local-save UI yet */
        },
    });
    window.Worker = originalWorker;

    const smartport = new SmartPort(cpu, null, { block: false });

    io.setSlot(6, disk2);
    io.setSlot(7, smartport);

    // apple2js's Audio class (js/ui/audio.ts) loads its AudioWorklet
    // processor from a hardcoded path, './dist/audio_worker.bundle.js',
    // matching apple2js's own webpack output layout. This app produces
    // that same file at the same URL via a small esbuild step
    // (scripts/build-audio-worklet.mjs, run before `dev`/`build`) rather
    // than a second full Vite config for one self-contained file — see
    // that script's comment. Audio class itself already listens for the
    // first keydown/mousedown/touchstart to resume the AudioContext
    // (required by browser autoplay policy), so no extra wiring is needed
    // beyond constructing it.
    const audio = new Audio(io);
    await audio.ready;

    return { apple2, disk2, smartport, cpu, audio };
}

/**
 * Forces POP into keyboard-input mode by writing 0 directly to `joyon`
 * (see JOYON_ADDRESS above) every call. The game does have a normal way to
 * do this at runtime — pressing Ctrl+K sends the `ksetkbd` key the game
 * itself listens for — but that only takes effect once, whenever the game
 * happens to poll the keyboard next, and nothing stops a later Ctrl+J (or
 * the game's own joystick auto-detection, if any) from switching back.
 * Calling this every frame (see main.ts's tick callback) makes keyboard
 * mode unconditional rather than a one-time nudge.
 */
export function forceKeyboardControls(cpu: CPU6502): void {
    cpu.write(JOYON_ADDRESS, 0);
}

/**
 * Fetches a 5.25" floppy image from a static URL and loads it into the
 * given DiskII drive.
 */
export async function loadDiskFromUrl(
    disk2: DiskII,
    driveNo: 1 | 2,
    url: string
): Promise<void> {
    const rawData = await fetchDiskImage(url);
    const { name, ext } = parseImageUrl(url);
    if (!includes(FLOPPY_FORMATS, ext)) {
        throw new Error(`Unrecognized floppy image extension: "${ext}"`);
    }
    await disk2.setBinary(driveNo, name, ext, rawData);
}

/**
 * Fetches a block-device image (e.g. .hdv) from a static URL and loads it
 * into the given SmartPort drive.
 */
export async function loadBlockImageFromUrl(
    smartport: SmartPort,
    driveNo: 1 | 2,
    url: string
): Promise<void> {
    const rawData = await fetchDiskImage(url);
    const { name, ext } = parseImageUrl(url);
    if (!includes(BLOCK_FORMATS, ext)) {
        throw new Error(`Unrecognized block image extension: "${ext}"`);
    }
    await smartport.setBinary(driveNo, name, ext, rawData);
}

async function fetchDiskImage(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch disk image: ${response.statusText}`);
    }
    return response.arrayBuffer();
}

function parseImageUrl(url: string): { name: string; ext: string } {
    const name = url.split('/').pop() || url;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return { name, ext };
}
