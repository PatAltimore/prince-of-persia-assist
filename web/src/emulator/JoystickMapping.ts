/**
 * Shared 8-way joystick math, factored out so TouchControls.ts (screen-
 * pixel drag deltas, radius = the on-screen ring's pixel radius) and
 * GamepadControls.ts (normalized -1..1 analog-stick axes, radius = 1)
 * drive the exact same paddle behavior from two different input sources
 * instead of two copies of this math slowly drifting apart.
 */

export interface Offset2D {
    dx: number;
    dy: number;
}

/**
 * POP only ever reads the joystick as one of 8 discrete directions anyway
 * (JSTKX/JSTKY end up -1/0/+1 — see CTRLSUBS.S's cvtpdl, comparing the
 * raw reading against calibrated thresholds), so free analog positioning
 * only adds jitter: an input meant to be pure "up" that wobbles a couple
 * degrees off-axis could read as up-left one moment and up-right the
 * next, which is exactly what makes precise combos (hold a direction to
 * run, then jump for a running long jump) unreliable. Snapping to the
 * nearest 45° and pinning the magnitude to the full radius removes that
 * ambiguity — every direction lands cleanly on one of the 8 states, same
 * as a classic digital/microswitch joystick (or, for a real Xbox
 * controller's D-pad, exactly what it already is).
 *
 * The trigonometry, worked through step by step:
 *
 * `Math.hypot(rawDx, rawDy)` computes √(dx² + dy²) — the straight-line
 * distance from center, by the Pythagorean theorem. That's the input's
 * *magnitude*, independent of direction.
 *
 * `Math.atan2(rawDy, rawDx)` gives the input's *angle*, in radians (the
 * unit most JS math functions use instead of degrees — a full circle is
 * 2π radians instead of 360°). Plain `Math.atan` only takes one argument
 * (a ratio) and can't tell "up-right" from "down-left", since both give
 * the same ratio of dy to dx; `atan2` takes dy and dx as *separate*
 * arguments specifically so it can look at their individual signs and
 * return the correct angle all the way around the circle, not just one
 * quadrant of it.
 *
 * `step = Math.PI / 4` is 45° expressed in radians (a half-turn is π
 * radians, or 180°, so an eighth-turn is π/4). Dividing the actual angle
 * by that step, rounding to the nearest whole number, then multiplying
 * back by the step is a standard "round to the nearest multiple of X"
 * trick — it snaps whatever angle the input actually was to the nearest
 * of the 8 compass directions (0°, 45°, 90°, ...).
 *
 * Finally, `Math.cos(angle)`/`Math.sin(angle)` convert that snapped angle
 * back into x/y coordinates on a circle of radius 1 (the literal
 * definition of sine and cosine — the x and y coordinates of the point at
 * a given angle around a unit circle) — multiplying by `radius` scales
 * that unit circle up to whatever scale the caller is working in (pixels
 * for a touch drag, -1..1 for a gamepad axis).
 */
export function snapToCompass(rawDx: number, rawDy: number, radius: number, deadzoneRatio: number): Offset2D {
    const dist = Math.hypot(rawDx, rawDy);
    if (dist < radius * deadzoneRatio) {
        return { dx: 0, dy: 0 };
    }
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(rawDy, rawDx) / step) * step;
    return {
        dx: Math.cos(angle) * radius,
        dy: Math.sin(angle) * radius,
    };
}

/**
 * Converts a single axis offset (-radius..radius) into an Apple2IO
 * paddle reading (0.0-1.0, 0.5 = center). The `* 1.414` (√2) factor
 * mirrors apple2js's own gamepad code (js/ui/gamepad.ts's
 * processGamepad) so a full-deflection input reads the same as a real
 * joystick pushed fully in one direction — it compensates for the fact
 * that a circular deadzone/range doesn't reach the paddle's true 0/1
 * extremes on each axis alone (a diagonal at radius 1 only has ~0.71 on
 * each individual axis without this compensation).
 */
export function paddleValueFromOffset(offset: number, radius: number): number {
    const n = offset / radius;
    return Math.max(0, Math.min(1, (n * 1.414 + 1) / 2.0));
}

/**
 * Dispatches a synthetic Ctrl+J keydown/keyup on `canvas` — the same
 * technique used to trigger POP's own joystick-calibration cheat
 * (SPECIALK.S's `ksetjstk`, which runs GRAFIX.S's SETCENTER) from
 * whichever non-keyboard input source (touch, gamepad) just engaged
 * joystick mode, instead of writing `joyon` directly, so calibration
 * runs exactly as it would for a real joystick — see
 * EmulatorController.ts's JOYON_ADDRESS comment for more on `joyon`.
 */
export function dispatchJoystickCalibration(canvas: HTMLCanvasElement): void {
    const eventOpts = { bubbles: true } as const;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...eventOpts }));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ...eventOpts }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'j', ...eventOpts }));
    canvas.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ...eventOpts }));
}
