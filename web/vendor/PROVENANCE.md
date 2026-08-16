# Provenance

`apple2js/` is a git submodule of [whscullin/apple2js](https://github.com/whscullin/apple2js) (MIT), pinned to commit `ee0aed25f73c69d0245e86a2a5fccb3324c3056c`, the exact commit boot-tested in [docs/SPIKE-NOTES.md](../../docs/SPIKE-NOTES.md).

This app uses apple2js's core emulation modules (`js/apple2.ts`, `js/cards/*`, `js/apple2io.ts`, `js/mmu.ts`, `js/ram.ts`, `js/videomodes.ts`, `js/canvas.ts`, `js/roms/*`, `js/formats/*`, and the `@whscullin/cpu6502` submodule package) directly via TypeScript path/Vite aliases (`js/*` → `vendor/apple2js/js/*`, see `tsconfig.json` and `vite.config.ts`) — the files are imported unmodified, not copied, so upstream fixes can be pulled by bumping the submodule commit.

Deliberately **not** used: apple2js's own UI layer (`js/components/*` React tree, `js/ui/apple2.ts` legacy DOM UI, both entry points `js/entry.tsx`/`js/main2.ts`). This app has its own UI (`web/src/`), built directly on the core classes — see `web/src/emulator/EmulatorController.ts`.

Two workarounds, both confined to `web/src/` (nothing in the vendored submodule is modified):

1. **`DiskII`'s Web Worker.** `js/cards/disk2.ts` unconditionally tries to start a Web Worker at a hardcoded webpack-specific path (`dist/format_worker.bundle.js`) that doesn't exist in this Vite build. `EmulatorController.ts` temporarily hides `window.Worker` while constructing `DiskII` so it falls back to its synchronous disk-decoding path instead (see the comment there).
2. **`apple2shader` (GPL-2.0) import.** `js/apple2.ts` unconditionally imports `js/gl.ts` (the WebGL/NTSC-shader video renderer), which imports `screenEmu` from the `apple2shader` package. This app always runs with `gl: false` (plain 2D canvas), so the GL classes that actually use `screenEmu` are never instantiated — but the import itself still has to resolve. `apple2shader`'s conditional `module.exports` pattern isn't statically analyzable by Vite's dev-time CJS interop, so `vite.config.ts` aliases `apple2shader` to `src/shims/apple2shader.ts`, a stub. See that file's comment for how to swap back to the real package if GL rendering is ever wanted.
