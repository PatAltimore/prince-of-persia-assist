const STORAGE_KEY = 'pop-assist-control-mode';

type ControlMode = 'touch' | 'keyboard';

function isControlMode(value: string | null): value is ControlMode {
    return value === 'touch' || value === 'keyboard';
}

/**
 * Manual override for the keyboard-legend-vs-touch-controls auto-detect
 * (see the `(pointer: coarse) and (not (any-pointer: fine))` media query
 * in style.css). That heuristic gets it wrong on real hardware in ways
 * that aren't fixable in CSS alone — a touchscreen-equipped desktop that
 * still wants the keyboard legend, or a Kindle Fire whose Fire OS build
 * reportedly changes what it reports for pointer capability between
 * portrait and landscape orientation (with a detachable keyboard case),
 * leaving it stuck on the keyboard legend in portrait despite being a
 * touch-only device there. The two `.control-mode-switch` buttons (one
 * embedded in each panel, so whichever panel is currently showing offers
 * a way to switch to the other) let the player just pick, and the choice
 * is remembered per-browser via localStorage so it doesn't need
 * re-picking every load.
 */
export function attachControlModeSwitch(): void {
    const toTouchBtn = document.querySelector<HTMLButtonElement>('#switch-to-touch-btn')!;
    const toKeyboardBtn = document.querySelector<HTMLButtonElement>('#switch-to-keyboard-btn')!;

    function apply(mode: ControlMode | null): void {
        document.body.classList.toggle('force-touch-controls', mode === 'touch');
        document.body.classList.toggle('force-keyboard-controls', mode === 'keyboard');
    }

    let saved: string | null = null;
    try {
        saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
        // Private-browsing/storage-disabled contexts can throw on access;
        // falling back to the CSS auto-detect default is fine.
    }
    if (isControlMode(saved)) {
        apply(saved);
    }

    toTouchBtn.addEventListener('click', () => {
        apply('touch');
        try {
            window.localStorage.setItem(STORAGE_KEY, 'touch');
        } catch {
            // Best-effort persistence only; the switch still works this session.
        }
    });

    toKeyboardBtn.addEventListener('click', () => {
        apply('keyboard');
        try {
            window.localStorage.setItem(STORAGE_KEY, 'keyboard');
        } catch {
            // Best-effort persistence only; the switch still works this session.
        }
    });
}
