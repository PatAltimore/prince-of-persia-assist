/**
 * A small de-duplicated log of "things the player just did," each tagged
 * with the POP source file(s) that explain it — surfaced in the Code tab
 * (see HintsSidePane.ts's "Recent actions" section) as a cheaper
 * alternative to a live "what's happening right now" display. A real-time
 * display would need the player to alternate between looking at the game
 * and looking at the side pane, which isn't practical mid-play; a short
 * history lets them check back after the fact instead.
 *
 * Keyed by `category` (one slot per category, e.g. `'room'`, `'fight'`, or
 * `cheat:${keys}` for a specific cheat) rather than an append-only array:
 * repeating the same category updates that one entry's timestamp/label in
 * place instead of adding a new line. This is what keeps the list from
 * filling up with e.g. seven separate "Entered a new room" entries when
 * POP's own attract-mode demo (AUTO.S) cycles through several rooms in a
 * few seconds while idling at the title screen — confirmed live earlier
 * as a real problem with the previous append-only design.
 *
 * Deliberately only logs a handful of discrete, already-known-cheaply
 * events (see call sites: keyboard.ts, TouchControls.ts, CheatCodes.ts,
 * HintsSidePane.ts's level/room/dev-mode polling) rather than the
 * character's full continuous animation state (which would need resolving
 * SEQTABLE.S's sequence-pointer addresses — the fuller, deferred version
 * of this feature). Movement itself isn't logged for the same reason it'd
 * be cheap-but-wrong: holding a direction would flood the log with
 * "walked" entries even with de-duplication (it's a real, distinct
 * direction each time, not a repeat).
 */
export interface ActionLogEntry {
    category: string;
    timestamp: number;
    label: string;
    filenames: string[];
}

const WINDOW_MS = 5 * 60 * 1000;

// `Map<K, V>` is JS's built-in key-value dictionary type — similar to a
// plain `{}` object used as a lookup table, but a better fit here for two
// reasons: keys can be looked up/deleted just as fast no matter how many
// entries exist, and (used below) it remembers *insertion* order when you
// iterate it, which a plain object doesn't reliably guarantee. Keying by
// `category` — rather than pushing onto an array — is what makes
// `logAction` naturally overwrite an existing entry instead of appending
// a duplicate: `Map.set` on a key that already exists just replaces that
// key's value.
const entries = new Map<string, ActionLogEntry>();

// `Set<T>` is a collection of unique values with no associated key (unlike
// a `Map`) — used here to hold a bunch of "please call me when something
// changes" callback functions. This whole `entries`/`listeners`
// combination is a minimal example of the "observer" (a.k.a. pub/sub)
// pattern: interested parties `.add()` themselves as listeners via
// `onActionLogged`, and `logAction` "publishes" an event by calling every
// listener currently in the set, without needing to know anything about
// who they are or how many there are.
const listeners = new Set<() => void>();

function prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    // `for (const [key, value] of someMap)` — destructuring straight out
    // of a for-of loop — is the standard way to iterate a Map's entries
    // when you need both the key and the value, as opposed to
    // `.values()` (just values, used below) or `.keys()` (just keys).
    for (const [category, entry] of entries) {
        if (entry.timestamp < cutoff) {
            entries.delete(category);
        }
    }
}

// Note that `entries` and `listeners` above are declared at module scope
// (outside any function), not inside `logAction`/etc. — that makes this
// whole file act like a singleton: every other file that
// `import { logAction } from './ActionLog'` is sharing the exact same
// `entries` Map, not getting its own private copy. That's the intended
// design here (one shared, app-wide action history), but it's worth
// noticing as a contrast to the closures used elsewhere in this codebase
// (see main.ts's note), where each *call* to a function like
// `attachKeyboard` gets its own independent private state.
export function logAction(category: string, label: string, filenames: string[]): void {
    const now = Date.now();
    entries.set(category, { category, timestamp: now, label, filenames });
    prune(now);
    for (const listener of listeners) {
        listener();
    }
}

/** Newest-updated first. */
export function getRecentActions(): ActionLogEntry[] {
    prune(Date.now());
    // `Array.from(entries.values())` copies the Map's values out into a
    // plain array (a Map itself has no `.sort()` — arrays do), and
    // `.sort((a, b) => b.timestamp - a.timestamp)` orders that array
    // newest-first. The comparator's contract: return negative if `a`
    // should come first, positive if `b` should, zero if it doesn't
    // matter — `b.timestamp - a.timestamp` is negative exactly when `a`
    // is newer (larger timestamp) than `b`, which is what puts newer
    // entries earlier in the result.
    return Array.from(entries.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/** Returns an unsubscribe function. */
export function onActionLogged(listener: () => void): () => void {
    listeners.add(listener);
    // Same "return a cleanup function" shape as attachKeyboard.ts's
    // return value — the caller gets back exactly the function it needs
    // to undo this subscription later, without having to keep its own
    // reference to `listener` and call `listeners.delete(listener)`
    // itself.
    return () => listeners.delete(listener);
}
