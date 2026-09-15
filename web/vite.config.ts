import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import dynamicImportVars from '@rollup/plugin-dynamic-import-vars';
import path from 'node:path';

/**
 * js/apple2.ts loads ROM modules via extensionless dynamic imports
 * (`import(`./roms/system/${options.rom}`)`). @rollup/plugin-dynamic-import-vars
 * (which is what makes these globbable/bundleable at all — otherwise they
 * silently 404 in a production build even though `vite dev` works fine,
 * since its dev server resolves any path live) hard-requires a file
 * extension in the static part of the template literal, and there is no
 * config option to relax that.
 *
 * Rather than patch the vendored submodule on disk (which would fight
 * `git submodule update` and complicate upstream diffing), this Vite
 * plugin rewrites just those two import expressions in memory as apple2.ts
 * is loaded — `enforce: 'pre'` so it runs before dynamic-import-vars sees
 * the code. Verified against a real `vite build` + `vite preview` (not
 * just `vite dev`) — see docs/SPIKE-NOTES.md.
 */
function apple2RomImportExtensionFix(): Plugin {
    return {
        name: 'apple2js-rom-import-extension-fix',
        enforce: 'pre',
        transform(code, id) {
            if (!id.endsWith('vendor/apple2js/js/apple2.ts')) {
                return null;
            }
            const patched = code
                .replace(
                    './roms/system/${options.rom}',
                    './roms/system/${options.rom}.ts'
                )
                .replace(
                    './roms/character/${options.characterRom}',
                    './roms/character/${options.characterRom}.ts'
                );
            if (patched === code) {
                throw new Error(
                    'apple2RomImportExtensionFix: expected import patterns not found in apple2.ts — upstream may have changed; update this plugin in vite.config.ts.'
                );
            }
            return { code: patched, map: null };
        },
    };
}

/**
 * js/ram.ts's `RAM.setState()` does `this.mem = new Uint8Array(state.mem)`
 * — reassigning to a brand-new typed array rather than copying into the
 * existing one. That breaks an aliasing relationship this app depends on:
 * js/canvas.ts's `HiresPage2D`/`LoresPage2D` obtain their pixel buffer via
 * `ram.getBuffer(start, end)`, which is `this.mem.subarray(...)` — a VIEW
 * into the *same* underlying memory, not a copy, taken once at
 * construction. After `setState()` reassigns `RAM.mem` to a new array,
 * that view keeps pointing at the old, now-stale one — the restored pixel
 * data lands in the new `RAM.mem` correctly, but the video renderer keeps
 * reading and repainting from the orphaned old buffer.
 *
 * Symptom (reported via playtesting): after Rewind/Continue, the screen
 * doesn't fully repaint — only whatever the game happens to redraw itself
 * on subsequent frames (e.g. the player sprite, redrawn every frame by its
 * own animation code, which writes through the *current* live buffer)
 * looks right; the static background remains stuck at its pre-restore
 * content, since nothing re-touches those bytes after a restore.
 *
 * Fix: copy into the existing array in place (`this.mem.set(state.mem)`)
 * instead of reassigning, preserving the identity every `subarray()` view
 * depends on — so restoring RAM state automatically keeps any aliased
 * views (present or future) correctly in sync, not just the two hi-res
 * pages this app happens to use today. Same in-memory transform approach
 * as apple2RomImportExtensionFix above, for the same reason (don't fight
 * `git submodule update` / upstream diffing).
 */
function apple2RamAliasingFix(): Plugin {
    return {
        name: 'apple2js-ram-setstate-aliasing-fix',
        enforce: 'pre',
        transform(code, id) {
            if (!id.endsWith('vendor/apple2js/js/ram.ts')) {
                return null;
            }
            const target = 'this.mem = new Uint8Array(state.mem);';
            const replacement = 'this.mem.set(state.mem);';
            if (!code.includes(target)) {
                throw new Error(
                    'apple2RamAliasingFix: expected RAM.setState() body not found in ram.ts — upstream may have changed; update this plugin in vite.config.ts.'
                );
            }
            return { code: code.replace(target, replacement), map: null };
        },
    };
}

/**
 * js/apple2.ts's own run loop unconditionally calls `processGamepad(this.io)`
 * (js/ui/gamepad.ts) every single tick, completely independent of anything
 * in src/ — it was already doing this before GamepadControls.ts existed.
 * Discovered by instrumenting Apple2IO.paddle during manual testing of the
 * new gamepad feature: with any gamepad connected, paddle 0/1 read
 * impossible values like 1.207 (see gamepad.ts's `(axes[0] * 1.414 + 1) /
 * 2.0`, applied with NO clamping — unlike JoystickMapping.ts's
 * paddleValueFromOffset, which clamps to 0..1 the same way apple2js's own
 * comment in EmulatorController.ts assumed it would). Worse, since this
 * runs *after* `this.tick()` (which is where GamepadControls.ts's own
 * `update()` runs, via main.ts's tick callback), its unclamped, deadzone-
 * free, D-pad-blind, single-gamepad-only (`navigator.getGamepads()[0]`,
 * hardcoded) writes silently overwrote GamepadControls.ts's correct ones on
 * every frame — GamepadControls.ts's careful 8-way snapping never actually
 * reached the game. (Its button-mapping half is harmless today only by
 * accident: gamepadMap stays empty unless `initGamepad()` is called, which
 * nothing in src/ does.)
 *
 * Neutralizing the call — rather than editing gamepad.ts itself — keeps
 * this a no-op if upstream ever changes gamepad.ts, and matches the
 * in-memory-transform pattern already used above for apple2.ts's other two
 * quirks, for the same "don't fight git submodule update" reasoning.
 */
function apple2DisableBuiltinGamepad(): Plugin {
    return {
        name: 'apple2js-disable-builtin-gamepad',
        enforce: 'pre',
        transform(code, id) {
            if (!id.endsWith('vendor/apple2js/js/apple2.ts')) {
                return null;
            }
            const target = 'processGamepad(this.io);';
            const replacement =
                '// processGamepad(this.io) intentionally disabled — see apple2DisableBuiltinGamepad in vite.config.ts';
            if (!code.includes(target)) {
                throw new Error(
                    'apple2DisableBuiltinGamepad: expected processGamepad(this.io) call not found in apple2.ts — upstream may have changed; update this plugin in vite.config.ts.'
                );
            }
            return { code: code.replace(target, replacement), map: null };
        },
    };
}

export default defineConfig({
    plugins: [
        apple2RomImportExtensionFix(),
        apple2RamAliasingFix(),
        apple2DisableBuiltinGamepad(),
        dynamicImportVars({
            include: ['vendor/apple2js/js/**/*.ts'],
        }),
    ],
    resolve: {
        alias: {
            // apple2shader's CJS export pattern isn't statically analyzable by
            // Vite's dev-time esbuild transform; see src/shims/apple2shader.ts.
            apple2shader: path.resolve(__dirname, 'src/shims/apple2shader.ts'),
            js: path.resolve(__dirname, 'vendor/apple2js/js'),
            json: path.resolve(__dirname, 'vendor/apple2js/json'),
        },
    },
    server: {
        fs: {
            allow: ['..'],
        },
    },
});
