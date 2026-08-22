/**
 * LEARNING NOTES — this file is the app's entry point (loaded directly by
 * index.html's <script type="module" src="/src/main.ts">). Reading it
 * top-to-bottom roughly walks through everything the app does at startup.
 *
 * A few concepts that show up repeatedly across this codebase, spelled
 * out once here so the more specific comments elsewhere can just refer
 * back to this:
 *
 * - **"Handle" objects.** Instead of classes, most modules here export a
 *   plain function (`attachX`/`renderX`) that sets up some behavior and
 *   returns a small object of callback functions — e.g. `{ update, debug }`
 *   for the room map, `{ isEngaged }` for touch controls. That returned
 *   object is called a "handle": it's the caller's remote control for
 *   whatever internal state the function just set up. This is a common
 *   lightweight alternative to defining a class with methods.
 *
 * - **Closures.** A closure is a function that "remembers" the variables
 *   from the scope it was created in, even after that scope has
 *   technically finished running. Every `attachX`/`renderX` function here
 *   declares some local state (`let engaged = false`, etc.) and returns
 *   inner functions that read/modify it — those inner functions are
 *   closures over that state. It's how this code gets private,
 *   encapsulated state without needing a class.
 *
 * - **The "tick" callback.** Real hardware runs continuously; an emulator
 *   fakes that by re-running one JavaScript function ("tick") roughly 60
 *   times per second (once per emulated video frame), each time
 *   simulating a small slice of CPU/video/audio time. Anything that needs
 *   to "watch" the emulator live (the room map, the rewind recorder, this
 *   file's joystick-mode toggle) hooks into that same tick rather than
 *   setting up its own timer.
 */
import { Apple2 } from 'js/apple2';
import { bootEmulator, loadDiskFromUrl, setJoystickInputEnabled } from './emulator/EmulatorController';
import { attachKeyboard } from './emulator/keyboard';
import { attachAutoDiskSwap, DiskSide } from './emulator/diskSwap';
import { renderHintsSidePane } from './ui/HintsSidePane/HintsSidePane';
import { renderCheatCodes } from './ui/HintsSidePane/CheatCodes';
import { renderRoomMap } from './ui/HintsSidePane/RoomMap';
import { attachTabs } from './ui/HintsSidePane/Tabs';
import { RewindBuffer, RewindRecorder } from './emulator/snapshot/RewindBuffer';
import { captureSnapshot } from './emulator/snapshot/SnapshotSerializer';
import { captureThumbnail } from './emulator/snapshot/thumbnail';
import { attachRewindScrubber, attachRewindButton } from './ui/RewindScrubber';
import { attachSaveLoadMenu } from './ui/SaveMenu';
import { attachTouchControls } from './ui/TouchControls';
import { attachControlModeSwitch } from './ui/ControlModeSwitch';

const DISK_A_URL = '/disks/PrinceOfPersia_5.25_SideA.nib';
const DISK_B_URL = '/disks/PrinceOfPersia_5.25_SideB.nib';

// A raw (unencoded) snapshot for this game measures ~451KB (mostly the
// ~233KB loaded disk image, plus ~166KB of RAM/aux-RAM — see
// docs/SPIKE-NOTES.md). 2 minutes of history at a 5s interval is 24
// entries, ~11MB peak.
const REWIND_SNAPSHOT_INTERVAL_MS = 5000;
const REWIND_TOTAL_MS = 2 * 60 * 1000;
const REWIND_CAPACITY = REWIND_TOTAL_MS / REWIND_SNAPSHOT_INTERVAL_MS;
const REWIND_BUTTON_SECONDS = 5;

// `main` is declared `async` so it can use `await` inside — see the
// `bootEmulator` call below, which has to finish (loading WASM-ish glue
// and setting up audio) before anything that depends on the emulator
// object can run. Being `async` also means calling `main()` returns a
// Promise instead of blocking, which is why the very bottom of this file
// calls `.catch(...)` on it — see the note there.
async function main() {
    // `document.querySelector<T>(...)` looks up an element by CSS
    // selector and the `<T>` tells TypeScript what type to treat the
    // result as (otherwise it'd just be the generic `Element`). The
    // trailing `!` is TypeScript's "non-null assertion": it tells the
    // compiler "trust me, this is never null" for elements we know
    // index.html always defines. Real production code would usually
    // check for null instead of asserting, but for a fixed, hand-written
    // page like this one, asserting is a reasonable simplification.
    const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
    const statusEl = document.querySelector<HTMLElement>('#disk-status')!;
    const resetBtn = document.querySelector<HTMLButtonElement>('#reset-btn')!;
    const rewindSlider = document.querySelector<HTMLInputElement>('#rewind-slider')!;
    const rewind5sBtn = document.querySelector<HTMLButtonElement>('#rewind-5s-btn')!;
    const rewindThumbnail = document.querySelector<HTMLImageElement>('#rewind-thumbnail')!;
    const hintsPane = document.querySelector<HTMLElement>('#hints-pane')!;

    // These three don't need the emulator to exist yet — they only touch
    // static DOM the page already has — so they run before the `await`
    // below, letting the page feel responsive immediately instead of
    // waiting on the (slower) emulator boot.
    const hintsSidePaneHandle = renderHintsSidePane(document.querySelector('#tab-panel-code')!);
    attachTabs(hintsPane);
    attachControlModeSwitch();

    const rewindBuffer = new RewindBuffer(REWIND_CAPACITY);
    // These are declared with `let` (reassignable) and start as
    // `undefined` because the things that create them (booting the
    // emulator, attaching touch controls, etc.) haven't happened yet at
    // this point in the function. The tick callback passed to
    // `bootEmulator` below closes over these same variables — see this
    // file's top-of-file note on closures — so once they *are* assigned
    // a few lines further down, the tick callback automatically sees the
    // real values on its next call. The `?.` ("optional chaining") used
    // when calling them later means "call this method only if the handle
    // isn't undefined," which avoids needing an explicit null check
    // everywhere they're used before they're ready.
    let apple2Ref: Apple2 | undefined;
    let scrubberHandle: { syncRange: () => void } | undefined;
    let roomMapHandle: { update: () => void; debug: () => unknown } | undefined;
    let diskSwapHandle: { onTick: () => void } | undefined;
    let touchControlsHandle: { isEngaged: () => boolean } | undefined;
    let sideABuffer: ArrayBuffer | undefined;
    let sideBBuffer: ArrayBuffer | undefined;
    const recorder = new RewindRecorder(
        rewindBuffer,
        REWIND_SNAPSHOT_INTERVAL_MS,
        // These two are passed as arrow functions — `() => captureSnapshot(apple2Ref!)`
        // — rather than calling `captureSnapshot(apple2Ref!)` directly and
        // passing the *result*. That distinction matters: `apple2Ref` is
        // still `undefined` at this exact line (the emulator hasn't
        // booted yet), so calling captureSnapshot right now would crash.
        // Wrapping it in a function delays the actual call until
        // RewindRecorder decides to invoke it later, by which point
        // apple2Ref has been assigned — the closure reads whatever
        // apple2Ref holds *at call time*, not at the time this line ran.
        () => captureSnapshot(apple2Ref!),
        () => captureThumbnail(canvas)
    );

    // `await` pauses this `async` function right here until the Promise
    // that `bootEmulator` returns settles, without blocking the rest of
    // the page/browser — other JS (event handlers, rendering) keeps
    // running during the wait. `{ apple2, disk2, cpu, audio } = ...` is
    // "destructuring": bootEmulator resolves to one object, and this
    // pulls four of its properties straight into four separate local
    // variables in one line, instead of writing
    // `const result = await bootEmulator(...); const apple2 = result.apple2; ...`.
    //
    // The arrow function passed as the second argument is the "tick"
    // callback mentioned in this file's top-of-file note — apple2js calls
    // it once per emulated video frame, and everything listed inside it
    // is this app's way of "riding along" on that same heartbeat rather
    // than polling on its own separate timer.
    const { apple2, disk2, cpu, audio } = await bootEmulator(canvas, () => {
        setJoystickInputEnabled(apple2, touchControlsHandle?.isEngaged() ?? false);
        recorder.onTick();
        scrubberHandle?.syncRange();
        roomMapHandle?.update();
        diskSwapHandle?.onTick();
        hintsSidePaneHandle.update(apple2);
    });
    apple2Ref = apple2;
    roomMapHandle = renderRoomMap(document.querySelector('#tab-panel-map')!, apple2);
    renderCheatCodes(document.querySelector('#tab-panel-cheats')!, apple2, canvas);
    touchControlsHandle = attachTouchControls(
        apple2.getIO(),
        canvas,
        document.querySelector('#touch-joystick')!,
        document.querySelector('#touch-joystick-thumb')!,
        document.querySelector('#touch-btn-0')!
    );

    // Debug handles, mirroring apple2js's own convention (window.apple2).
    // `window` is the browser's global object — anything attached to it
    // is reachable from the browser DevTools console, e.g. typing
    // `__apple2.getCPU().read(0x20)` while the page is open. `Object.assign`
    // copies all the properties from the second object onto the first, so
    // this is a shorthand for five separate `window.__x = x` assignments.
    // This is purely a development/debugging convenience — nothing in the
    // app itself reads these globals back.
    Object.assign(window, {
        __apple2: apple2,
        __rewindBuffer: rewindBuffer,
        __touchControls: touchControlsHandle,
        __audio: audio,
        __roomMap: roomMapHandle,
    });

    attachKeyboard(apple2, canvas);
    // The <canvas> needs to actually have keyboard focus for its own
    // 'keydown'/'keyup' listeners (wired up by attachKeyboard) to receive
    // events at all — that's just how the DOM routes keyboard input, to
    // whichever single element currently has focus. Focusing it once at
    // startup, and again on every click (in case the player clicks
    // somewhere else on the page first), keeps movement keys working.
    canvas.addEventListener('click', () => canvas.focus());
    canvas.focus();

    /**
     * A bare `apple2.reset()` simulates a hardware Ctrl-RESET: it jumps to
     * the ROM reset vector, which on a real Apple II auto-boots from
     * whatever's in the drive — but it does *not* touch the drive's
     * contents. If the player has reached level 3+, diskSwap.ts has
     * already transparently swapped the emulated drive to side 2 (POP's
     * own disk driver asks for it, mid-game); side 2 has no bootstrap
     * track of its own, so resetting while it's "inserted" tries to boot
     * from unbootable media — this is what produced garbled screens
     * (reported as the screen filling with repeated characters) instead
     * of a working restart. Reloading side 1 fresh first — mirroring
     * exactly what this app's own initial boot does — guarantees there's
     * always something bootable in the drive before the reset fires, and
     * replacing diskSwapHandle (rather than just calling disk2.setBinary
     * directly) resets attachAutoDiskSwap's own notion of which side is
     * "currently" loaded, so it doesn't think it's already on side 1
     * (skipping a real swap later) or side 2 (attempting a swap to a side
     * that's already loaded).
     */
    async function resetToSideA() {
        if (!sideABuffer || !sideBBuffer) {
            return; // disks haven't finished loading yet
        }
        diskSwapHandle = undefined; // pause auto-swap while the drive's contents change under it
        apple2.stop();
        await disk2.setBinary(1, 'PrinceOfPersia_5.25_SideA.nib', 'nib', sideABuffer);
        diskSwapHandle = attachAutoDiskSwap(cpu, disk2, apple2.getIO(), 1, {
            1: { name: 'PrinceOfPersia_5.25_SideA.nib', data: sideABuffer },
            2: { name: 'PrinceOfPersia_5.25_SideB.nib', data: sideBBuffer },
        });
        apple2.reset();
        apple2.run();
        canvas.focus();
    }

    resetBtn.addEventListener('click', () => {
        // resetToSideA is `async`, so calling it returns a Promise — but
        // this click handler doesn't need to do anything once it
        // finishes, so there's nothing to `await`. TypeScript's linter
        // would otherwise warn about an "unhandled" Promise (in case it
        // rejects and nobody notices); the `void` keyword here is a way
        // of explicitly saying "yes, I know this returns a Promise, and
        // I'm deliberately not using it" — the code behaves identically
        // with or without it, but tools stop flagging the calling site.
        void resetToSideA();
    });
    scrubberHandle = attachRewindScrubber(rewindSlider, apple2, rewindBuffer, canvas, rewindThumbnail);
    attachRewindButton(rewind5sBtn, apple2, rewindBuffer, canvas, REWIND_BUTTON_SECONDS);

    attachSaveLoadMenu(apple2, canvas, statusEl, {
        saveBtn: document.querySelector('#save-btn')!,
        loadBtn: document.querySelector('#load-btn')!,
        saveDialog: document.querySelector('#save-dialog')!,
        saveForm: document.querySelector('#save-form')!,
        saveNameInput: document.querySelector('#save-name-input')!,
        saveError: document.querySelector('#save-error')!,
        saveCancelBtn: document.querySelector('#save-cancel-btn')!,
        loadDialog: document.querySelector('#load-dialog')!,
        loadList: document.querySelector('#load-list')!,
        loadEmpty: document.querySelector('#load-empty')!,
        loadCancelBtn: document.querySelector('#load-cancel-btn')!,
    });

    try {
        await loadDiskFromUrl(disk2, 1, DISK_A_URL);
        statusEl.textContent = 'Prince of Persia loaded';

        // Prefetch both sides once so mid-game auto-swaps (see
        // diskSwap.ts) don't wait on a network round-trip. Kept around
        // (not just local to this block) so the reset button can also
        // reload side 1 fresh — see resetToSideA().
        //
        // `fetch(url)` returns a Promise for the HTTP response; `.then(r =>
        // r.arrayBuffer())` chains a second async step that reads the
        // response body into raw bytes, itself also returning a Promise —
        // so each array element here is a "Promise of a Promise's result,"
        // which JS automatically flattens into just one Promise per fetch.
        // `Promise.all([...])` takes an array of Promises and returns one
        // Promise that resolves once *all* of them have — so both disk
        // images download concurrently (not one after the other), and
        // `await` only unblocks once both are ready. The result is an
        // array in the same order as the input, which the `[a, b] = ...`
        // destructuring syntax unpacks into the two named variables.
        [sideABuffer, sideBBuffer] = await Promise.all([
            fetch(DISK_A_URL).then((r) => r.arrayBuffer()),
            fetch(DISK_B_URL).then((r) => r.arrayBuffer()),
        ]);
        const initialSide: DiskSide = 1;
        diskSwapHandle = attachAutoDiskSwap(cpu, disk2, apple2.getIO(), initialSide, {
            1: { name: 'PrinceOfPersia_5.25_SideA.nib', data: sideABuffer },
            2: { name: 'PrinceOfPersia_5.25_SideB.nib', data: sideBBuffer },
        });
    } catch (err) {
        // `await`ing a rejected Promise throws, exactly like a synchronous
        // `throw` would — that's what lets ordinary `try`/`catch` handle
        // asynchronous failures (a failed fetch, a bad disk image) the
        // same way it handles synchronous ones, instead of needing
        // separate error-handling machinery for async code.
        statusEl.textContent = 'Failed to load disk';
        console.error(err);
        return;
    }

    apple2.reset();
    apple2.run();
}

// `main()` is `async`, so calling it doesn't run it to completion right
// here — it starts running and immediately hands back a Promise, while
// the function's own body keeps executing in the background across
// however many `await`s it contains. If anything inside throws (or a
// `fetch` fails, etc.) without being caught internally, that surfaces as
// this outer Promise rejecting — and an unhandled rejection at the top
// level would otherwise just be a silent console warning. This `.catch(...)`
// is what turns "the app quietly failed to start" into a visible error
// message on the page itself.
main().catch((err) => {
    console.error(err);
    const statusEl = document.querySelector<HTMLElement>('#disk-status');
    if (statusEl) {
        statusEl.textContent = 'Emulator failed to start — see console';
    }
});
