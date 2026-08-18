# Prince of Persia - Assist mode

A browser-playable Prince of Persia (Apple II, 1989) emulator, built from Jordan Mechner's officially released 6502 assembly source, paired with a hints side panel linking into [Code Museum](https://blue-rock-0e6a0831e.7.azurestaticapps.net/#/prince-of-persia), developer debug cheats, save states, and a gameplay rewind buffer.

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

Hosted on Azure Static Web Apps (free tier) via `.github/workflows/azure-static-web-apps.yml`, which builds `web/` (`app_location: "web"`, `output_location: "dist"`, no API/Functions) on every push to `main` and on pull requests (with PR preview environments).

The workflow needs an Azure resource and a GitHub secret that only you can create — this repo can't provision Azure resources itself:

1. **Create the Static Web App** in the [Azure Portal](https://portal.azure.com) (or `az staticwebapp create`): Free tier ("Free" hosting plan), any name/region, deployment source "Other" (since deployment is via this repo's own GitHub Actions workflow, not Azure's auto-generated one — skip linking a GitHub repo during creation if prompted, or delete the auto-generated workflow it creates and keep this one).
2. **Get the deployment token**: in the created resource, go to *Overview → Manage deployment token*, copy it.
3. **Add it as a GitHub secret**: in this repo's GitHub settings, *Settings → Secrets and variables → Actions → New repository secret*, name it `AZURE_STATIC_WEB_APPS_API_TOKEN`, paste the token.
4. Push to `main` (or open a PR) — the workflow builds and deploys automatically.

```bash
cd web
npm run build
npm run preview
```
