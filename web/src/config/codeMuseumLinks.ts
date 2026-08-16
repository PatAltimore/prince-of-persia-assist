/**
 * Code Museum (https://blue-rock-0e6a0831e.7.azurestaticapps.net) is a
 * companion site with per-source-file explainer articles for this game.
 * Its deep-link format was confirmed directly from its rendered DOM (not
 * guessed): `#/prince-of-persia/<slug>`, where `<slug>` is the source
 * filename lowercased with the `.S` extension stripped — e.g. `MOVER.S` ->
 * `#/prince-of-persia/mover`. Isolated here in one function so a routing
 * change on Code Museum's side is a one-file fix.
 */
const CODE_MUSEUM_BASE = 'https://blue-rock-0e6a0831e.7.azurestaticapps.net';

export const CODE_MUSEUM_ROOT_URL = `${CODE_MUSEUM_BASE}/#/prince-of-persia`;

export function codeMuseumUrlForFile(filename: string): string {
    const slug = filename.replace(/\.S$/i, '').toLowerCase();
    return `${CODE_MUSEUM_BASE}/#/prince-of-persia/${slug}`;
}
