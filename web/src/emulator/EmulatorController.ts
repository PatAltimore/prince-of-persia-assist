import DiskII from 'js/cards/disk2';
import SmartPort from 'js/cards/smartport';
import { Apple2 } from 'js/apple2';
import { Audio } from 'js/ui/audio';
import { CPU6502 } from '@whscullin/cpu6502';
import { BLOCK_FORMATS, FLOPPY_FORMATS } from 'js/formats/types';
import { includes } from 'js/types';

/**
 * LEARNING NOTES — this file talks directly to the emulated Apple II's
 * memory and CPU, which is a different mental model than most web
 * development. Two ideas worth having straight before the comments below
 * make full sense:
 *
 * - **The 6502's whole address space is memory-mapped.** A real Apple II
 *   CPU (a 6502) can only do one thing: read or write a byte at a 16-bit
 *   address (`$0000`–`$FFFF`, i.e. 0–65535 — the `$` or `0x` prefix just
 *   means "the following digits are hexadecimal/base-16", the
 *   conventional way 6502 addresses are written). Most of that address
 *   space is plain RAM, but the *hardware itself* — the keyboard, the
 *   paddles/joystick, the disk drive — is wired up so that reading or
 *   writing specific addresses talks to that hardware instead of to RAM.
 *   `cpu.read(0x005b)`/`cpu.write(addr, value)` in this codebase are
 *   doing exactly what a 6502 assembly instruction like `LDA $005B`
 *   would do on real hardware — that's why so many comments here cite an
 *   assembly source file and a specific hex address: that address *is*
 *   the variable, the same way a JS variable name refers to a spot in
 *   memory the JS engine manages for you.
 *
 * - **"Bank switching" is how the //e fits more RAM than the CPU can
 *   address.** 65536 addresses is only 64KB, but the enhanced Apple //e
 *   this app emulates has 128KB of RAM. Its solution: two full 64KB banks
 *   ("main" and "aux") that share the *same* address range, with a
 *   hardware switch ("softswitch" — see RAMRD/RAMWRT mentioned below)
 *   deciding which bank actually responds when the CPU reads or writes a
 *   given address. The practical consequence, learned the hard way
 *   elsewhere in this codebase (see RoomMap.ts and CheatCodes.ts's
 *   comments): the *same* address can hold two different values at once,
 *   one per bank, and a plain `cpu.read`/`cpu.write` only ever sees
 *   whichever bank the softswitch currently points at — not necessarily
 *   the one you meant.
 */

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

// An `interface` in TypeScript describes the *shape* an object must have
// — which properties, and what type each one is — without providing any
// implementation. It only exists at compile time (there's no trace of it
// in the actual JS this becomes); its job is purely to let the compiler
// check that whoever calls `bootEmulator` and destructures its result
// (see main.ts) is using the right property names and types.
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
// `tick: () => void` is a TypeScript function type: it says "whatever you
// pass for `tick` must itself be a function that takes no arguments and
// returns nothing." main.ts passes the arrow function that syncs the room
// map, rewind recorder, etc. — this signature is what lets TypeScript
// check that call site is passing something with the right shape.
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

    // apple2js does a chunk of its own async setup internally (loading
    // ROM images, etc.) and exposes a `ready` Promise that resolves once
    // that's done. Awaiting it here means nothing below this line runs
    // until the emulator object is actually usable.
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
    // This save-and-restore pattern is a temporary, deliberate "monkey
    // patch": swap out a global (`window.Worker`, the browser's Web
    // Worker constructor) just long enough to influence how the DiskII
    // constructor behaves, then immediately put the real one back so
    // nothing else on the page is affected. `window.Worker = undefined`
    // is a type error under normal TypeScript rules (the browser's own
    // type definitions say `Worker` is always a constructor, never
    // undefined) — `@ts-expect-error` on the line above tells the
    // compiler "yes, I know this line doesn't type-check, allow it
    // anyway," which is TypeScript's escape hatch for the rare cases
    // where you need to do something its type system can't express
    // safely. If the line stopped being an error (e.g. after a library
    // upgrade), this comment would make the build fail instead of
    // silently leaving stale, unnecessary suppression in place.
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

    // A "card" in Apple II terms is a physical expansion board plugged
    // into one of the machine's slots — a disk controller, a printer
    // interface, extra memory, etc. — each mapped to its own small
    // address range so the CPU can talk to it. apple2js models this the
    // same way: `io.setSlot(n, card)` is the software equivalent of
    // physically plugging `card` into slot `n`.
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
 * Directly sets `joyon` (see JOYON_ADDRESS above) in *both* RAM banks,
 * bypassing whatever bank the RAMRD/RAMWRT softswitch currently points a
 * plain `cpu.write` at. `enabled: false` forces keyboard-input mode
 * (mirroring the old `ksetkbd`/Ctrl+K cheat, but every frame so nothing —
 * not even the game's own joystick auto-detection — can switch it back);
 * `enabled: true` is used once the on-screen joystick (TouchControls.ts)
 * is engaged.
 *
 * The dual-bank write is required by the same hazard already fixed for
 * RoomMap.ts's `level` read: the //e's aux-bank rendering code (HIRES.S)
 * toggles RAMRD/RAMWRT constantly, so a single-bank write (plain
 * `cpu.write`) can leave the two banks holding different values for the
 * same "variable" — confirmed live by writing `joyon` through a plain
 * `cpu.write` and then observing the main bank hold 0 while the aux bank
 * still held 0xff from the game's own SETCENTER (see TouchControls.ts's
 * Ctrl+J dispatch), with `cpu.read` flapping between the two values tick
 * to tick depending on whichever bank happened to be selected at that
 * instant. Since the game's own gameplay loop can equally end up reading
 * either bank, only writing both consistently guarantees it sees the
 * intended value.
 */
export function setJoystickInputEnabled(apple2: Apple2, enabled: boolean): void {
    // `apple2.ram` genuinely exists at runtime (it's the array of RAM
    // banks — a `Uint8Array` per bank, a typed array of raw bytes) but
    // isn't part of the `Apple2` class's public TypeScript type, since
    // apple2js doesn't officially expose it as API. `apple2 as unknown as
    // {...}` is a type assertion — "treat this value as if it had this
    // other shape" — used here as a deliberate, narrow escape hatch to
    // reach a field the compiler doesn't know about. Going through
    // `unknown` first (rather than asserting the new shape directly) is
    // required because TypeScript normally only allows a type assertion
    // between two types that overlap; `unknown` is compatible with
    // everything, so it's the standard two-step way to assert to an
    // otherwise-unrelated shape.
    const banks = (apple2 as unknown as { ram?: Array<{ mem: Uint8Array }> }).ram;
    const value = enabled ? 0xff : 0;
    if (!banks) {
        return;
    }
    // `for (const bank of banks)` is a "for-of" loop: it iterates over
    // the *values* in an array (here, each RAM bank object) one at a
    // time, as opposed to a classic `for (let i = 0; i < banks.length; i++)`
    // which iterates over *indices* you then use to look up each value.
    for (const bank of banks) {
        bank.mem[JOYON_ADDRESS] = value;
    }
}

/**
 * Fetches a 5.25" floppy image from a static URL and loads it into the
 * given DiskII drive.
 */
// `driveNo: 1 | 2` is a TypeScript "union of literal types": instead of
// the general `number`, it says the only two acceptable values are
// exactly 1 or 2 — passing 3 here would be a compile-time error. This is
// a common pattern for parameters with a small, fixed set of valid
// values, giving you the safety of an enum without needing to define one.
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
    // `fetch` only rejects (throws) on a *network* failure (DNS
    // couldn't resolve, connection refused, etc.) — an HTTP error like a
    // 404 still counts as a "successful" fetch as far as the browser is
    // concerned, since it did get a response, just not a helpful one.
    // `response.ok` is the shorthand for "status code in the 200-299
    // range"; checking it explicitly and throwing here is what turns an
    // HTTP error into something the `try`/`catch` in main.ts's boot
    // sequence will actually notice.
    if (!response.ok) {
        throw new Error(`Failed to fetch disk image: ${response.statusText}`);
    }
    // `.arrayBuffer()` reads the whole response body into memory as raw
    // bytes (an `ArrayBuffer`) rather than, say, `.text()` or `.json()` —
    // appropriate here since a disk image is arbitrary binary data, not
    // text.
    return response.arrayBuffer();
}

// `url.split('/').pop()` splits a string into an array on every '/' and
// takes the last element — a quick way to get "the filename" off the end
// of a path without a dedicated URL-parsing library. Chained again on
// '.', the same trick pulls off "the extension". The `|| url`/`|| ''`
// fallbacks handle the (here, purely defensive) edge case where `.pop()`
// finds nothing to return.
function parseImageUrl(url: string): { name: string; ext: string } {
    const name = url.split('/').pop() || url;
    const ext = name.split('.').pop()?.toLowerCase() || '';
    return { name, ext };
}
