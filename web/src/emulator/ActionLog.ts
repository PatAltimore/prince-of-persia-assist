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

const entries = new Map<string, ActionLogEntry>();
const listeners = new Set<() => void>();

function prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    for (const [category, entry] of entries) {
        if (entry.timestamp < cutoff) {
            entries.delete(category);
        }
    }
}

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
    return Array.from(entries.values()).sort((a, b) => b.timestamp - a.timestamp);
}

/** Returns an unsubscribe function. */
export function onActionLogged(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
