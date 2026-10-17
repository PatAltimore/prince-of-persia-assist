# Prince of Persia - Assist mode

A browser-playable Prince of Persia (Apple II, 1989) emulator, built from Jordan Mechner's officially released 6502 assembly source, paired with a hints side panel linking into [Code Museum](https://pataltimore.github.io/code-museum/#/prince-of-persia), developer debug cheats, save states, and a gameplay rewind buffer.

Play the game in your desktop or mobile browser at [https://pataltimore.github.io/prince-of-persia-assist/](https://pataltimore.github.io/prince-of-persia-assist/).

## Disclaimer

The Prince of Persia Apple II source code was released by Jordan Mechner for **study and personal use**. This does **not** constitute a grant of rights to the Prince of Persia game itself — Ubisoft owns and retains all rights to the Prince of Persia franchise. This project is a **non-commercial, educational fan project**, not affiliated with or endorsed by Ubisoft or Jordan Mechner.

## What this is

- A real Apple II system emulator (not a JS reimplementation) running the actual game, assembled from source.
- A side panel linking each source file to its explainer article on Code Museum.
- Best-effort rewind (scrub back through recent play) and Save Game to `localStorage`.

## Provenance

| Component | Source | License | Role |
|---|---|---|---|
| Game source | [jmechner/Prince-of-Persia-Apple-II](https://github.com/jmechner/Prince-of-Persia-Apple-II) (`vendor/prince-of-persia-apple2-src`, submodule) | Study/personal use only, see upstream README | Assembled into the bootable disk image shipped with the app |
| Assembler/disk-imaging tool | [adamgreen/snapNcrackle](https://github.com/adamgreen/snapNcrackle) (`build-tooling/snapncrackle`, submodule) | GPL-2.0 | **Build-time only** — turns the source into a `.dsk`/`.po` image. Never imported into the shipped web app. |
| Emulator core | [whscullin/apple2js](https://github.com/whscullin/apple2js) (vendored subset in `web/src/emulator/apple2-core`) | MIT | Runs the assembled disk image client-side in the browser |

## Building the disk image

See [build-tooling/scripts/build-disk-image.ps1](build-tooling/scripts/build-disk-image.ps1). The resulting `.dsk` is checked into `web/public/disks/` since the source rarely changes — CI does not need to rebuild it on every deploy.

## Running locally

```bash
cd web
npm install
npm run dev
```

## Deployment

Hosted on GitHub Pages via `.github/workflows/github-pages.yml`, which builds `web/` and deploys `web/dist` on every push to `main`.

One-time setup: in the repo's *Settings → Pages*, set *Source* to **GitHub Actions**. The site is then served at `https://pataltimore.github.io/prince-of-persia-assist/`.

```bash
cd web
npm run build
npm run preview
```
