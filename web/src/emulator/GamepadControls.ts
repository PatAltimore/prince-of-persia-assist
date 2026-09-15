import Apple2IO from 'js/apple2io';
import { logAction } from './ActionLog';
import { snapToCompass, paddleValueFromOffset, dispatchJoystickCalibration } from './JoystickMapping';

// Button/axis indices per the W3C "standard" gamepad mapping
// (https://www.w3.org/TR/gamepad/#remapping), which is what Chrome/Edge/
// Firefox all report an Xbox controller as. `navigator.getGamepads()`
// entries not recognized as a known layout report `mapping: ''` instead
// of `'standard'` — this module doesn't check that and just assumes
// standard, which covers Xbox/PlayStation-style controllers, the large
// majority of what anyone actually plugs in.
const BUTTON_ACTION = 0; // Xbox "A"
const BUTTON_START = 9; // Xbox "Menu"/"Start" — browsers report it at this index either way
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

// Analog sticks report -1..1 per axis directly (unlike TouchControls.ts's
// pixel-space drag, which needs its own radius) — see JoystickMapping.ts,
// whose functions are parameterized by radius specifically so both
// callers can share them.
const STICK_RADIUS = 1;
const STICK_DEADZONE_RATIO = 0.25;
// The D-pad is already perfectly discrete (each direction is its own
// on/off button, no wobble to filter) — its own tiny deadzone just avoids
// treating "everything released" (dx = dy = 0) as an ambiguous direction.
const DPAD_DEADZONE_RATIO = 0.01;

export interface GamepadControlsHandle {
    update: () => void;
    isEngaged: () => boolean;
}

/**
 * Drives the same Apple2IO paddle/button API as TouchControls.ts and a
 * real joystick would, from a connected gamepad (Xbox controller or
 * anything else the browser recognizes as "standard" layout): the left
 * stick/D-pad for movement, the "A" button for fight/draw sword/pick up,
 * and Start for advancing the title/credits screens and beginning actual
 * gameplay — POP treats any ordinary keypress as "continue," so this
 * dispatches a synthetic Enter on the canvas the same way TouchControls.ts
 * dispatches a synthetic Ctrl+J, rather than needing the game to know
 * anything about gamepads at all.
 *
 * Unlike TouchControls.ts, joystick mode is engaged as soon as a gamepad
 * is detected rather than waiting for the first real movement —
 * sidestepping the calibration race documented in TouchControls.ts's
 * pointerdown handler entirely, since there's no way for a freshly-detected
 * gamepad to already be holding a direction at the exact instant it's
 * detected the way an off-center first touch can. By the time a human
 * reacts and actually moves the stick, several emulator ticks have already
 * passed — plenty of time for the game to have processed the calibration
 * keypress.
 *
 * Detection itself doesn't rely solely on the 'gamepadconnected' event —
 * see findConnectedIndex below for why.
 */
export function attachGamepadControls(io: Apple2IO, canvas: HTMLCanvasElement): GamepadControlsHandle {
    let engaged = false;
    let connectedIndex: number | null = null;
    let actionWasPressed = false;
    let startWasPressed = false;

    function engageJoystickMode(): void {
        if (engaged) {
            return;
        }
        engaged = true;
        dispatchJoystickCalibration(canvas);
    }

    // The Gamepad API is undefined in very old browsers; feature-detect
    // once here rather than letting every future `update()` call fail.
    if (typeof navigator.getGamepads !== 'function') {
        return { update: () => {}, isEngaged: () => false };
    }

    function centerAndRelease(): void {
        io.paddle(0, 0.5);
        io.paddle(1, 0.5);
        if (actionWasPressed) {
            io.buttonDown(0, false);
            actionWasPressed = false;
        }
    }

    // 'gamepadconnected' only reliably fires for a controller that connects
    // (or is first pressed) *after* the page has loaded and has focus — a
    // controller that was already connected/paired (common for a wireless
    // Xbox controller left on) often never fires it at all, per Chrome's
    // own documented Gamepad API behavior, silently leaving this module
    // permanently inert with no error of any kind. So this is a fast-path
    // for the common "plugged in after load" case, not the only way
    // connectedIndex gets set — findConnectedIndex()'s per-tick scan below
    // (the same approach apple2js's own original gamepad.ts used:
    // `navigator.getGamepads()[0]`, no event dependency at all) is what
    // makes detection actually reliable.
    window.addEventListener('gamepadconnected', (e: GamepadEvent) => {
        connectedIndex = e.gamepad.index;
        engageJoystickMode();
    });

    window.addEventListener('gamepaddisconnected', (e: GamepadEvent) => {
        if (connectedIndex === e.gamepad.index) {
            connectedIndex = null;
            centerAndRelease();
        }
    });

    function findConnectedIndex(): number | null {
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++) {
            if (pads[i]) {
                return i;
            }
        }
        return null;
    }

    function dispatchStartKey(): void {
        // "Start" here means the same thing pressing Enter on a physical
        // keyboard already means to POP: continue past the title/credits
        // screens, or acknowledge whatever else is currently waiting for
        // a keypress. There's no separate "start button" concept in the
        // original game to wire up specifically — this is just another
        // way to send the keypress a player would otherwise reach for the
        // keyboard to send.
        const opts = { bubbles: true } as const;
        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...opts }));
        canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', ...opts }));
    }

    function update(): void {
        if (connectedIndex === null) {
            connectedIndex = findConnectedIndex();
            if (connectedIndex === null) {
                return;
            }
            engageJoystickMode();
        }
        // `navigator.getGamepads()` returns a live-updating array (one
        // slot per USB/Bluetooth port the browser is tracking, most of
        // them usually `null`) — re-fetched every call rather than cached,
        // since the objects inside it are what the browser refreshes each
        // frame; holding onto an old reference wouldn't see new input.
        const pad = navigator.getGamepads()[connectedIndex];
        if (!pad) {
            // The pad vanished without a 'gamepaddisconnected' event ever
            // reaching us (or reached us for a different index) — treat it
            // the same as a proper disconnect rather than leaving stale
            // paddle/button state stuck.
            connectedIndex = null;
            centerAndRelease();
            return;
        }

        const dpadLeft = pad.buttons[DPAD_LEFT]?.pressed ?? false;
        const dpadRight = pad.buttons[DPAD_RIGHT]?.pressed ?? false;
        const dpadUp = pad.buttons[DPAD_UP]?.pressed ?? false;
        const dpadDown = pad.buttons[DPAD_DOWN]?.pressed ?? false;
        const dpadActive = dpadLeft || dpadRight || dpadUp || dpadDown;

        let dx: number;
        let dy: number;
        if (dpadActive) {
            // D-pad takes priority over the stick whenever it's held —
            // simplest to reason about, and pressing both at once isn't a
            // real scenario worth designing around.
            const rawDx = (dpadRight ? 1 : 0) - (dpadLeft ? 1 : 0);
            const rawDy = (dpadDown ? 1 : 0) - (dpadUp ? 1 : 0);
            ({ dx, dy } = snapToCompass(rawDx, rawDy, STICK_RADIUS, DPAD_DEADZONE_RATIO));
        } else {
            const axisX = pad.axes[0] ?? 0;
            const axisY = pad.axes[1] ?? 0;
            ({ dx, dy } = snapToCompass(axisX, axisY, STICK_RADIUS, STICK_DEADZONE_RATIO));
        }
        io.paddle(0, paddleValueFromOffset(dx, STICK_RADIUS));
        io.paddle(1, paddleValueFromOffset(dy, STICK_RADIUS));

        // The Gamepad API has no keydown/keyup-style events — `.pressed`
        // is just the button's current state, polled fresh every tick —
        // so a "was it *just* pressed this tick" edge needs tracking by
        // hand (comparing against last tick's state) the same way
        // keyboard.ts uses `!event.repeat` to log the fight action once
        // per press rather than once per tick it's held.
        const actionPressed = pad.buttons[BUTTON_ACTION]?.pressed ?? false;
        if (actionPressed && !actionWasPressed) {
            io.buttonDown(0, true);
            logAction('fight', 'Fight / draw sword / pick up', ['CTRL.S', 'CTRLSUBS.S']);
        } else if (!actionPressed && actionWasPressed) {
            io.buttonDown(0, false);
        }
        actionWasPressed = actionPressed;

        const startPressed = pad.buttons[BUTTON_START]?.pressed ?? false;
        if (startPressed && !startWasPressed) {
            dispatchStartKey();
            logAction('menu', 'Started / advanced past a menu screen (gamepad)', ['TOPCTRL.S', 'MASTER.S']);
        }
        startWasPressed = startPressed;
    }

    return { update, isEngaged: () => engaged };
}
