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
    // `/\.S$/i` is a regular expression (regex) — a pattern for matching
    // text. Piece by piece: `\.` matches a literal dot (a plain `.` in a
    // regex means "any character," so it has to be escaped with a
    // backslash to mean an actual period); `S` matches that letter; `$`
    // anchors the match to the *end* of the string, so this only matches
    // a `.S` right at the end, not one appearing in the middle; the `i`
    // flag (after the closing `/`) makes the match case-insensitive, so
    // it catches both `.S` and `.s`. `.replace(pattern, '')` then removes
    // whatever matched — the net effect is "strip a trailing .S/.s
    // extension, if there is one."
    const slug = filename.replace(/\.S$/i, '').toLowerCase();
    return `${CODE_MUSEUM_BASE}/#/prince-of-persia/${slug}`;
}
