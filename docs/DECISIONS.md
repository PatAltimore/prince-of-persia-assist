# Decisions

ADR-style log of judgment calls made during this project. Dated, with rationale, so they can be revisited if circumstances change.

## 2026-08-15 — Hosting: Azure Static Web Apps (free tier)

The app is a pure client-side static bundle (no server logic needed). This matches the hosting model already used by the companion Code Museum site, and Static Web Apps' free tier includes GitHub Actions CI/CD and PR preview environments, which App Service's free F1 tier doesn't offer as cleanly (and F1 sleeps on idle / has a CPU-minute quota that a static site doesn't need to pay for).

## 2026-08-15 — Disk assembly: snapNcrackle first, fallback open

snapNcrackle (GPL-2.0, archived 2021) was purpose-built to assemble this exact source. It's the natural first attempt despite being unmaintained. If it can't be built/run, the fallback is a `ca65`-based build with a Merlin-syntax preprocessing shim, and only after that a bespoke minimal assembler, in that order — see SPIKE-NOTES.md for the actual outcome.

## 2026-08-15 — Build environment: Docker, not WSL

WSL is not installed/registered on the development machine (`wsl --list` fails with `REGDB_E_CLASSNOTREG`). Docker Desktop (29.3.1, `desktop-linux` context) is installed and running, so the snapNcrackle build uses a pinned Docker image instead of requiring a WSL install. This also happens to make the build more reproducible for anyone else picking up this repo, regardless of their WSL setup.

## 2026-08-15 — GPL-2.0 boundary: snapNcrackle is build-time only

snapNcrackle is GPL-2.0. It lives in `build-tooling/snapncrackle` and is used only to produce the `.dsk` disk image asset — its code is never imported into, linked with, or shipped as part of the `web/` application. The *output* of a GPL tool (a data file, not a derivative of the tool's own source) is not itself subject to the tool's license. This is a standard "build tool vs. shipped artifact" boundary (same category as using `gcc` to compile something — the compiler's license doesn't propagate to the compiled output), but it's called out explicitly here since it's the kind of judgment call worth being able to point to later rather than assuming silently.

## 2026-08-15 — Emulator integration: vendor a subset of apple2js, not the whole app

apple2js ships as a full standalone web app (`apple2js.html` + its own UI/settings/routing), not a packaged library. Rather than fork the entire app and rip out its UI, only the core emulation modules (CPU6502, system class, disk drive, video renderer, input handling) are extracted into `web/src/emulator/apple2-core/`, with a `PROVENANCE.md` recording the exact upstream commit they were taken from. This keeps the fork-maintenance surface small and makes it possible to diff against upstream later if bugs are found.

## 2026-08-15 — Hints panel: link out, don't embed

The side panel links to Code Museum articles in a new tab (`target="_blank" rel="noopener"`) rather than iframing them. Code Museum's per-file deep-link format was confirmed directly from its rendered DOM: `#/prince-of-persia/<filename lowercased, ".S" stripped>` (e.g. `MOVER.S` → `#/prince-of-persia/mover`). This avoids any risk of the two Azure Static Web Apps' framing/CSP headers conflicting, at the cost of a tab switch instead of an inline view.

## 2026-08-15 — apple2shader (GPL-2.0) ships as a stub, not the real package

`js/apple2.ts` unconditionally imports `js/gl.ts` (WebGL/NTSC-shader rendering), which depends on `apple2shader`, GPL-2.0-licensed — a different situation from snapNcrackle, since if we shipped the real package it would be bundled into the runtime app, not confined to a build step. We sidestepped the question entirely rather than ruling on GPL/MIT combination: this app always runs with `gl: false` (plain 2D canvas, also required for reliable pixel-based automated testing — see SPIKE-NOTES), so the GL code path that uses `apple2shader` is never instantiated. `apple2shader` is replaced with a stub at `web/src/shims/apple2shader.ts` (aliased in `vite.config.ts`), so the real GPL-licensed package isn't part of the app at all — nothing to reconcile. If GL/NTSC-shader rendering is wanted later, swap the alias back and revisit the licensing question properly then. See `web/vendor/PROVENANCE.md` for the other apple2js integration workaround (DiskII's hardcoded Web Worker path).

## 2026-08-15 — Legal posture: public hosting with a persistent disclaimer

Jordan Mechner's source release is for study/personal use and does not grant rights to the Prince of Persia game itself (Ubisoft owns that IP). Decision: proceed with public hosting as a non-commercial educational/fan project, with a persistent (not dismissible-and-forgotten) on-page disclaimer. This is the user's explicit call, not an assumption.

## 2026-08-16 — Ship with DebugKeys=1, not the original release's DebugKeys=0

The shipped disk image is **not** a byte-for-byte match for the original 1989 release's build configuration. `SPECIALK.S` has `DebugKeys = 0` at the top of the file (compiles out the `TempDevel` cheat routines — antimatter/invincibility, level skip, strength changes, etc. — the same setting the original shipped game used). This project's build flips it to `1` so those cheats are genuinely present and reachable, and the Cheats tab documents them as real, working features rather than inert trivia.

This is a deliberate content/feature decision, not a technical necessity — the user explicitly chose to ship the cheats-enabled build as the *default* (not an opt-in toggle) after the feasibility was demonstrated (see SPIKE-NOTES.md for the verification: same build succeeds cleanly, `joyon`/`level`/`develment` addresses this project already depends on are unaffected, and the assembled `TempDevel` bytes were inspected directly to confirm the code is genuinely present, not just that the build didn't error). `EditorDisk` and `FinalDisk` remain `0`, matching the original — only `DebugKeys` changed. The vendored submodule itself was never modified in git: the source flip was made, built, then reverted via `git checkout` immediately after, so only the *build output* differs from what the pristine submodule would otherwise produce.
