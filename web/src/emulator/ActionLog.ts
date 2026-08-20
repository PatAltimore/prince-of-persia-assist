/**
 * A small rolling log of "things the player just did," each tagged with
 * the POP source file(s) that explain it — surfaced in the Code tab (see
 * HintsSidePane.ts's "Recent actions" section) as a cheaper alternative to
 * a live "what's happening right now" display. A real-time display would
 * need the player to alternate between looking at the game and looking at
 * the side pane, which isn't practical mid-play; a short history lets them
 * check back after the fact instead.
 *
 * Deliberately only logs a handful of discrete, already-known-cheaply
 * events (see call sites: keyboard.ts, TouchControls.ts, CheatCodes.ts,
 * HintsSidePane.ts's level/room/dev-mode polling) rather than the
 * character's full continuous animation state (which would need resolving
 * SEQTABLE.S's sequence-pointer addresses — the fuller, deferred version
 * of this feature). Movement itself isn't logged for the same reason it'd
 * be cheap-but-wrong: holding a direction would flood the log with
 * "walked" entries.
 */
export interface ActionLogEntry {
    timestamp: number;
    label: string;
    filenames: string[];
}

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 30;

let entries: ActionLogEntry[] = [];
const listeners = new Set<() => void>();

function prune(now: number): void {
    if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(entries.length - MAX_ENTRIES);
    }
    const cutoff = now - WINDOW_MS;
    while (entries.length > 0 && entries[0].timestamp < cutoff) {
        entries.shift();
    }
}

export function logAction(label: string, filenames: string[]): void {
    const now = Date.now();
    entries.push({ timestamp: now, label, filenames });
    prune(now);
    for (const listener of listeners) {
        listener();
    }
}

/** Oldest first is how they're stored; callers wanting newest-first should reverse. */
export function getRecentActions(): ActionLogEntry[] {
    prune(Date.now());
    return entries.slice();
}

/** Returns an unsubscribe function. */
export function onActionLogged(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
