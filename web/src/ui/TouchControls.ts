import Apple2IO from 'js/apple2io';
import { logAction } from '../emulator/ActionLog';
import { snapToCompass, paddleValueFromOffset, dispatchJoystickCalibration } from '../emulator/JoystickMapping';

/**
 * LEARNING NOTES —
 *
 * **Pointer Events.** This file uses 'pointerdown'/'pointermove'/
 * 'pointerup'/'pointercancel' rather than separate mouse ('mousedown',
 * etc.) and touch ('touchstart', etc.) event types. Pointer Events is a
 * newer web standard that unifies mouse, touch, and pen/stylus input
 * behind one API — a finger dragging on a phone and a mouse dragging on a
 * desktop fire the exact same event types with the same properties
 * (`.clientX`/`.clientY`, `.pointerId`), so this one set of listeners
 * handles both without needing touch-specific and mouse-specific code
 * paths.
 *
 * **`pointerId` and multi-touch.** A touchscreen can track several
 * fingers touching the screen at once, each generating its own stream of
 * pointer events tagged with a distinct `pointerId`. `joystickPointerId`
 * below records *which* finger is currently dragging the joystick, so
 * that a second finger tapping the fight button elsewhere on the screen
 * (a different `pointerId`) doesn't get mistaken for joystick input, and
 * so a stray pointermove from an unrelated pointer is ignored.
 *
 * **Pointer capture.** `setPointerCapture(id)` (used below) asks the
 * browser to keep routing that pointer's future events to this element
 * specifically, even if the finger/mouse physically moves outside its
 * boundaries — normally, dragging past an element's edge would start
 * delivering events to whatever's *now* underneath the pointer instead.
 */
const BASE_RADIUS_PX = 60;

// Below this fraction of the radius, treat the stick as centered rather
// than snapping to a direction — otherwise the slightest touch jitter
// right at the middle would flip between two opposite 8-way directions.
const DEADZONE_RATIO = 0.3;

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
    button0: HTMLElement
): TouchControlsHandle {
    let engaged = false;

    function engageJoystickMode() {
        if (engaged) {
            return;
        }
        engaged = true;
        // See JoystickMapping.ts's dispatchJoystickCalibration doc comment
        // for what this actually does and why — shared with
        // GamepadControls.ts, which engages joystick mode the same way.
        dispatchJoystickCalibration(canvas);
    }

    let joystickPointerId: number | null = null;
    // Wherever the finger actually lands becomes the logical center for
    // this drag — not the ring's fixed geometric center. Tapping the base
    // is rarely pixel-perfect on a real touchscreen, and measuring from
    // the ring's visual center meant an off-center tap read as an
    // immediate, unintended shove in whatever direction it happened to
    // land — e.g. tapping slightly right of center moved the character
    // right before any real swipe even started. Recording the touch-down
    // point and measuring every subsequent move as a delta from *that*
    // makes the joystick "float": the tap itself is always neutral
    // (0,0 relative to itself), and only the actual drag motion counts.
    let touchOrigin: { x: number; y: number } | null = null;

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
        io.paddle(0, paddleValueFromOffset(dx, BASE_RADIUS_PX));
        io.paddle(1, paddleValueFromOffset(dy, BASE_RADIUS_PX));
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
        touchOrigin = { x: e.clientX, y: e.clientY };
        joystickBase.classList.add('touch-joystick-pressed');
        try {
            joystickBase.setPointerCapture(e.pointerId);
        } catch {
            // Capture is a nice-to-have (keeps tracking the finger if it
            // slides outside the base); engagement and paddle updates
            // below must not depend on it succeeding.
        }
        engageJoystickMode();
        // Deliberately not calling updateFromPointer here: with the
        // floating origin above, the delta at the instant of touch-down
        // is always (0, 0) by construction (the touch point *is* the
        // origin), so there'd be nothing to apply yet regardless. That
        // also happens to sidestep a real calibration race on the very
        // first-ever engagement: the Ctrl+J just dispatched only *queues*
        // a keypress — the game's SETCENTER calibration (GRAFIX.S)
        // doesn't actually run until a later emulator tick polls the
        // keyboard, and it calibrates its "center" thresholds around
        // whatever paddle reading is live *at that moment*. Applying a
        // nonzero paddle value here would race ahead of that and get
        // baked in as the calibrated center, breaking whichever direction
        // happened to be live. The first pointermove (which necessarily
        // comes later, after the game has had time to process the
        // keypress) is what starts actually driving the paddle.
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
        touchOrigin = null;
        resetJoystick();
    }

    window.addEventListener('pointerup', endJoystickPointer);
    window.addEventListener('pointercancel', endJoystickPointer);

    function updateFromPointer(e: PointerEvent) {
        if (!touchOrigin) {
            return;
        }
        // See JoystickMapping.ts's snapToCompass doc comment for the full
        // trigonometry walkthrough — shared with GamepadControls.ts's
        // analog-stick handling.
        const { dx, dy } = snapToCompass(e.clientX - touchOrigin.x, e.clientY - touchOrigin.y, BASE_RADIUS_PX, DEADZONE_RATIO);
        setThumb(dx, dy);
        setPaddlesFromOffset(dx, dy);
    }

    function wireButton(el: HTMLElement) {
        const press = (e: PointerEvent) => {
            e.preventDefault();
            engageJoystickMode();
            io.buttonDown(0);
            logAction('fight', 'Fight / draw sword / pick up', ['CTRL.S', 'CTRLSUBS.S']);
        };
        const release = () => io.buttonDown(0, false);
        // Three different events all trigger the same release logic,
        // because there are three different ways a "press" can end:
        // 'pointerup' is the normal case (finger/mouse lifted while still
        // over the button); 'pointercancel' fires when the browser itself
        // interrupts the gesture (e.g. an incoming phone call, or the OS
        // deciding it's actually a screen-scroll gesture); 'pointerleave'
        // fires if the finger slides off the button's edge without ever
        // lifting. Without all three, some real-world release paths would
        // leave the button stuck "held down" from the game's perspective.
        el.addEventListener('pointerdown', press);
        el.addEventListener('pointerup', release);
        el.addEventListener('pointercancel', release);
        el.addEventListener('pointerleave', release);
    }

    wireButton(button0);

    return { isEngaged: () => engaged };
}
