import { CPU6502 } from '@whscullin/cpu6502';

/**
 * Memory address of EQ.S's `level` flag. Resolved from this build's list
 * files (e.g. `build-tooling/pop-build/obj/MASTER.LST`:
 * `03F4: 00  463 level ds 1`) — same technique as JOYON_ADDRESS in
 * EmulatorController.ts. Specific to this exact assembled binary; re-check
 * if web/public/disks/* is ever rebuilt from source.
 */
const LEVEL_ADDRESS = 0x03f4;

interface LevelEntry {
    value: number;
    label: string;
    note?: string;
}

/**
 * Sourced directly from TOPCTRL.S's comments and level-transition logic,
 * not guessed or pulled from outside references:
 * - "In: A = level # (0 for demo, 1 for game)" — level 0 is the
 *   attract-mode demo loop, not a real playable level.
 * - "don't announce level 0 or 14" groups 0 and 14 as non-level screens;
 *   14 is reached only after level 13, and level 13's own comment
 *   ("Timer stops when you kill Vizier on level 13") identifies it as the
 *   final confrontation — so 14 is the epilogue/ending.
 * - Levels 6 and 12 have their own special-cased screen-exit transitions
 *   noted directly in TOPCTRL.S.
 * - `web/public/disks/*` was assembled from source lacking a LEVEL3 data
 *   file (see the Makefile's GAME_DATA list) — level 3 exists in the
 *   `level` numbering but has no separate background data of its own.
 */
const LEVELS: LevelEntry[] = [
    { value: 0, label: 'Demo', note: 'Attract-mode loop, not a real level' },
    { value: 1, label: 'Level 1', note: 'Starts without the sword' },
    { value: 2, label: 'Level 2' },
    { value: 3, label: 'Level 3', note: 'No separate background data in the build' },
    { value: 4, label: 'Level 4' },
    { value: 5, label: 'Level 5' },
    { value: 6, label: 'Level 6', note: 'Falling off screen 1 cuts straight to Level 7' },
    { value: 7, label: 'Level 7' },
    { value: 8, label: 'Level 8' },
    { value: 9, label: 'Level 9' },
    { value: 10, label: 'Level 10' },
    { value: 11, label: 'Level 11' },
    { value: 12, label: 'Level 12', note: 'Exiting screen 23 cuts straight to Level 13' },
    { value: 13, label: 'Level 13', note: 'Face the Grand Vizier Jaffar' },
    { value: 14, label: 'Epilogue', note: 'Rescue the Princess' },
];

/**
 * Renders a live level-progress track into `container`, reading the
 * current level straight from emulated memory. Returns an `update()`
 * function to call periodically (see main.ts's tick callback) — cheap
 * (one byte read, early-returns if unchanged), safe to call every frame.
 */
export function renderLevelMap(
    container: HTMLElement,
    cpu: CPU6502
): { update: () => void } {
    container.innerHTML = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Level map';
    container.appendChild(heading);

    const intro = document.createElement('p');
    intro.className = 'cheat-intro';
    intro.textContent =
        "Live progress through the game, read directly from emulated memory (EQ.S's level variable).";
    container.appendChild(intro);

    const track = document.createElement('ol');
    track.className = 'level-track';

    const itemsByValue = new Map<number, HTMLLIElement>();
    for (const entry of LEVELS) {
        const item = document.createElement('li');
        item.className = 'level-item';

        const num = document.createElement('span');
        num.className = 'level-num';
        num.textContent = entry.label;
        item.appendChild(num);

        if (entry.note) {
            const note = document.createElement('span');
            note.className = 'level-note';
            note.textContent = entry.note;
            item.appendChild(note);
        }

        track.appendChild(item);
        itemsByValue.set(entry.value, item);
    }
    container.appendChild(track);

    let lastValue = -1;
    const update = () => {
        const value = cpu.read(LEVEL_ADDRESS);
        if (value === lastValue) {
            return;
        }
        lastValue = value;
        for (const [v, item] of itemsByValue) {
            item.classList.toggle('level-current', v === value);
        }
    };
    update();

    return { update };
}
