import { State } from 'js/apple2';
import { encodeSnapshotToJSON, decodeSnapshotFromJSON } from './SnapshotSerializer';

// LEARNING NOTE — `window.localStorage` is the browser's built-in
// key-value store: it can only hold *strings* (any object has to be
// serialized to a string first — see JSON.stringify/parse throughout this
// file), and everything saved persists across page reloads and even
// browser restarts, scoped per-origin (this app's saves are invisible to
// other websites, and vice versa). It's synchronous — no `await` needed —
// which is convenient here but means large reads/writes (like a few
// hundred KB save file) briefly block the page; fine at this scale.
const INDEX_KEY = 'pop-assist:saves-index:v1';
const DATA_KEY_PREFIX = 'pop-assist:save-data:v1:';

export interface SaveMeta {
    id: string;
    name: string;
    savedAt: number;
}

// This module stores each save game under its own localStorage key
// (`DATA_KEY_PREFIX + id`, so the big encoded snapshot data), plus one
// separate "index" entry (`INDEX_KEY`) listing just the lightweight
// metadata — id/name/timestamp — for every save. That split exists
// because localStorage has no way to ask "what keys exist starting with
// this prefix" or "list everything" — the index is this code's own
// manually-maintained table of contents, kept in sync by `readIndex`/
// `writeIndex` every time a save is added, renamed, or deleted.
function readIndex(): SaveMeta[] {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (!raw) {
        return [];
    }
    try {
        return JSON.parse(raw) as SaveMeta[];
    } catch {
        // A `catch` block with no parameter (just `catch {`, not `catch (err) {`)
        // is valid whenever the caught error's details aren't needed —
        // here, any parse failure (corrupted/hand-edited localStorage)
        // is treated the same way: fall back to "no saves" rather than
        // crash the whole app over one bad value.
        return [];
    }
}

function writeIndex(index: SaveMeta[]): void {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

/** Most-recently-saved first. */
export function listSaves(): SaveMeta[] {
    return readIndex().sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Saves under `name`. A save with the exact same name is overwritten (same
 * id, refreshed timestamp) rather than creating a duplicate entry.
 *
 * Each encoded snapshot is a few hundred KB (see RewindBuffer.ts's size
 * notes) and localStorage is commonly capped around 5-10MB per origin, so
 * this can realistically only hold a handful to a couple dozen saves
 * before hitting the browser's quota — surfaced as a thrown Error rather
 * than silently failing or corrupting the save index.
 */
export function saveGame(name: string, state: State): SaveMeta {
    const index = readIndex();
    // `.find(predicate)` returns the first array element the predicate
    // returns true for, or `undefined` if none match — used here to check
    // whether a save with this exact name already exists.
    const existing = index.find((s) => s.name === name);
    // `existing?.id` reads `.id` only if `existing` isn't
    // undefined/null (see RewindBuffer.ts's note on `?.`); `??` ("nullish
    // coalescing") then supplies the right-hand side *only* if the
    // left-hand side was null/undefined. Together: "reuse the existing
    // save's id if there is one, otherwise generate a fresh one." The
    // fresh id itself is just the current timestamp plus a few random
    // base-36 (0-9 and a-z) characters — not cryptographically unique,
    // but more than good enough for "won't collide with another save
    // made on this same browser."
    const id =
        existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const meta: SaveMeta = { id, name, savedAt: Date.now() };

    try {
        window.localStorage.setItem(DATA_KEY_PREFIX + id, encodeSnapshotToJSON(state));
    } catch (err) {
        // localStorage.setItem throws (rather than failing silently) when
        // the browser's per-origin storage quota is exceeded — catching
        // it here and re-throwing a clearer, save-specific `Error`
        // (rather than letting the browser's generic quota error
        // surface as-is) is what lets SaveMenu.ts show the player a
        // useful message instead of a cryptic one.
        throw new Error(
            `Couldn't save "${name}" — browser storage may be full. Try deleting an old save first. (${String(err)})`
        );
    }

    // This ternary picks between two ways of building the new index
    // depending on whether this was an overwrite or a brand-new save:
    // `.map()` walks every existing entry, swapping in the updated `meta`
    // only where the id matches and leaving every other entry as-is —
    // building a whole new array rather than mutating the old one in
    // place. `[...index, meta]` ("spread") does the array equivalent of
    // `existing?.id ?? ...` above's object mixing: it copies every
    // element of `index` into a new array literal, then adds `meta` after
    // them. Both are examples of an "immutable update" style — instead of
    // changing `index` itself, a new array describing the desired end
    // state is built and swapped in.
    const nextIndex = existing
        ? index.map((s) => (s.id === id ? meta : s))
        : [...index, meta];
    writeIndex(nextIndex);

    return meta;
}

export function loadSave(id: string): State | null {
    const json = window.localStorage.getItem(DATA_KEY_PREFIX + id);
    if (json === null) {
        return null;
    }
    return decodeSnapshotFromJSON(json);
}

export function deleteSave(id: string): void {
    window.localStorage.removeItem(DATA_KEY_PREFIX + id);
    writeIndex(readIndex().filter((s) => s.id !== id));
}
