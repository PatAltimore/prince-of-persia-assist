import { Apple2 } from 'js/apple2';
import { bootEmulator, loadDiskFromUrl, forceKeyboardControls } from './emulator/EmulatorController';
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

async function main() {
    const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
    const statusEl = document.querySelector<HTMLElement>('#disk-status')!;
    const resetBtn = document.querySelector<HTMLButtonElement>('#reset-btn')!;
    const rewindSlider = document.querySelector<HTMLInputElement>('#rewind-slider')!;
    const rewind5sBtn = document.querySelector<HTMLButtonElement>('#rewind-5s-btn')!;
    const rewindThumbnail = document.querySelector<HTMLImageElement>('#rewind-thumbnail')!;
    const hintsPane = document.querySelector<HTMLElement>('#hints-pane')!;

    renderCheatCodes(document.querySelector('#tab-panel-cheats')!);
    renderHintsSidePane(document.querySelector('#tab-panel-code')!);
    attachTabs(hintsPane);

    const rewindBuffer = new RewindBuffer(REWIND_CAPACITY);
    let apple2Ref: Apple2 | undefined;
    let scrubberHandle: { syncRange: () => void } | undefined;
    let roomMapHandle: { update: () => void } | undefined;
    let diskSwapHandle: { onTick: () => void } | undefined;
    const recorder = new RewindRecorder(
        rewindBuffer,
        REWIND_SNAPSHOT_INTERVAL_MS,
        () => captureSnapshot(apple2Ref!),
        () => captureThumbnail(canvas)
    );

    const { apple2, disk2, cpu, audio } = await bootEmulator(canvas, () => {
        forceKeyboardControls(cpu);
        recorder.onTick();
        scrubberHandle?.syncRange();
        roomMapHandle?.update();
        diskSwapHandle?.onTick();
    });
    apple2Ref = apple2;
    roomMapHandle = renderRoomMap(document.querySelector('#tab-panel-map')!, apple2);

    // Debug handles, mirroring apple2js's own convention (window.apple2).
    Object.assign(window, {
        __apple2: apple2,
        __rewindBuffer: rewindBuffer,
        __audio: audio,
    });

    attachKeyboard(apple2, canvas);
    canvas.addEventListener('click', () => canvas.focus());
    canvas.focus();

    resetBtn.addEventListener('click', () => {
        apple2.reset();
        canvas.focus();
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
        // diskSwap.ts) don't wait on a network round-trip.
        const [sideAData, sideBData] = await Promise.all([
            fetch(DISK_A_URL).then((r) => r.arrayBuffer()),
            fetch(DISK_B_URL).then((r) => r.arrayBuffer()),
        ]);
        const initialSide: DiskSide = 1;
        diskSwapHandle = attachAutoDiskSwap(cpu, disk2, apple2.getIO(), initialSide, {
            1: { name: 'PrinceOfPersia_5.25_SideA.nib', data: sideAData },
            2: { name: 'PrinceOfPersia_5.25_SideB.nib', data: sideBData },
        });
    } catch (err) {
        statusEl.textContent = 'Failed to load disk';
        console.error(err);
        return;
    }

    apple2.reset();
    apple2.run();
}

main().catch((err) => {
    console.error(err);
    const statusEl = document.querySelector<HTMLElement>('#disk-status');
    if (statusEl) {
        statusEl.textContent = 'Emulator failed to start — see console';
    }
});
