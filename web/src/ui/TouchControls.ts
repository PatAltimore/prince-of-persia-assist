import Apple2IO from 'js/apple2io';

const BASE_RADIUS_PX = 60;

export interface TouchControlsHandle {
    isEngaged: () => boolean;
}

/**
 * Drives the on-screen joystick/button overlay (see .touch-controls in
 * style.css, shown only on coarse-pointer/touch devices) by calling the
 * same Apple2IO paddle/button API a real joystick would use.
 *
 * The `(v * 1.414 + 1) / 2` mapping mirrors apple2js's own gamepad code
 * (js/ui/gamepad.ts's processGamepad) so a full-deflection drag reads the
 * same as a real joystick pushed fully in one direction, compensating for
 * the fact that a circular deadzone doesn't reach the paddle's true 0/1
 * extremes on each axis alone.
 *
 * POP only reads the joystick at all once `joyon` is nonzero (see
 * JOYON_ADDRESS in EmulatorController.ts) — normally set via the game's
 * own Ctrl+J (`ksetjstk`) cheat key, which also runs its `SETCENTER`
 * calibration routine (GRAFIX.S). Dispatching a synthetic Ctrl+J keydown/
 * keyup on the canvas on first touch triggers that same native path
 * instead of writing `joyon` directly, so calibration runs exactly as it
 * would for a real joystick.
 */
export function attachTouchControls(
    io: Apple2IO,
    canvas: HTMLCanvasElement,
    joystickBase: HTMLElement,
    joystickThumb: HTMLElement,
    button0: HTMLElement,
    button1: HTMLElement
): TouchControlsHandle {
    let engaged = false;

    function engageJoystickMode() {
        if (engaged) {
            return;
        }
        engaged = true;
        const eventOpts = { bubbles: true } as const;
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...eventOpts }));
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ...eventOpts }));
        canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'j', ...eventOpts }));
        canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ...eventOpts }));
    }

    let joystickPointerId: number | null = null;

    // The thumb is already centered on the base via CSS (top/left: 50% +
    // negative margin — see .touch-joystick-thumb), so the offset here is
    // a plain pixel translate from that centered rest position, not
    // relative to the thumb's own box. An earlier version also baked in a
    // `translate(-50%, -50%)` baseline, which is meaningless once CSS
    // already centers the element via margin — it just added a redundant
    // extra shift equal to half the thumb's own size, so the ball visibly
    // sat up-left of true center any time this function had ever run
    // (i.e. after any drag/release, though not before the first touch).
    function setThumb(dx: number, dy: number) {
        joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
    }

    function setPaddlesFromOffset(dx: number, dy: number) {
        const nx = dx / BASE_RADIUS_PX;
        const ny = dy / BASE_RADIUS_PX;
        const x = clamp01((nx * 1.414 + 1) / 2.0);
        const y = clamp01((ny * 1.414 + 1) / 2.0);
        io.paddle(0, x);
        io.paddle(1, y);
    }

    function resetJoystick() {
        io.paddle(0, 0.5);
        io.paddle(1, 0.5);
        setThumb(0, 0);
        joystickBase.classList.remove('touch-joystick-pressed');
    }

    joystickBase.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        joystickPointerId = e.pointerId;
        joystickBase.classList.add('touch-joystick-pressed');
        try {
            joystickBase.setPointerCapture(e.pointerId);
        } catch {
            // Capture is a nice-to-have (keeps tracking the finger if it
            // slides outside the base); engagement and paddle updates
            // below must not depend on it succeeding.
        }
        engageJoystickMode();
        updateFromPointer(e);
    });

    // Deliberately bound on window, not joystickBase: a real drag routinely
    // carries the finger past the 60px base circle (the radius only clamps
    // the *reported* paddle value, not where the finger physically is), and
    // if setPointerCapture didn't stick, a release out there fires on
    // whatever element is actually under the finger — e.g. the canvas —
    // which never bubbles up through joystickBase. Listening on window
    // guarantees the up/cancel is seen (and the joystick recentered)
    // regardless of where the finger ends up.
    window.addEventListener('pointermove', (e) => {
        if (e.pointerId !== joystickPointerId) {
            return;
        }
        e.preventDefault();
        updateFromPointer(e);
    });

    function endJoystickPointer(e: PointerEvent) {
        if (e.pointerId !== joystickPointerId) {
            return;
        }
        joystickPointerId = null;
        resetJoystick();
    }

    window.addEventListener('pointerup', endJoystickPointer);
    window.addEventListener('pointercancel', endJoystickPointer);

    function updateFromPointer(e: PointerEvent) {
        const rect = joystickBase.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        let dx = e.clientX - centerX;
        let dy = e.clientY - centerY;
        const dist = Math.hypot(dx, dy);
        if (dist > BASE_RADIUS_PX) {
            dx = (dx / dist) * BASE_RADIUS_PX;
            dy = (dy / dist) * BASE_RADIUS_PX;
        }
        setThumb(dx, dy);
        setPaddlesFromOffset(dx, dy);
    }

    function wireButton(el: HTMLElement, button: 0 | 1) {
        const press = (e: PointerEvent) => {
            e.preventDefault();
            engageJoystickMode();
            io.buttonDown(button);
        };
        const release = () => io.buttonDown(button, false);
        el.addEventListener('pointerdown', press);
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('pointerleave', release);
    }

    wireButton(button0, 0);
    wireButton(button1, 1);

    return { isEngaged: () => engaged };
}

function clamp01(v: number): number {
    return Math.max(0, Math.min(1, v));
}
