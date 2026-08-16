// Stub replacement for the `apple2shader` package (GPL-2.0, WebGL/NTSC shader
// renderer). js/apple2.ts unconditionally imports js/gl.ts, which imports
// `screenEmu` from this package, even though this app always runs with
// `gl: false` (see EmulatorController.ts) and so never instantiates any of
// the GL video-mode classes that actually dereference screenEmu's contents.
// Vite's dev-time CJS interop also can't cleanly load apple2shader's actual
// screenEmu.js (conditional `module.exports` pattern isn't statically
// analyzable), so rather than fight that for dead code, this stub stands in
// for it. If GL rendering is ever wanted later, swap this alias (in
// vite.config.ts) back to the real vendored file.
export const screenEmu: unknown = {};
