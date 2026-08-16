import { State } from 'js/apple2';
import { encodeSnapshotToJSON, decodeSnapshotFromJSON } from './SnapshotSerializer';

const INDEX_KEY = 'pop-assist:saves-index:v1';
const DATA_KEY_PREFIX = 'pop-assist:save-data:v1:';

export interface SaveMeta {
    id: string;
    name: string;
    savedAt: number;
}

function readIndex(): SaveMeta[] {
    const raw = window.localStorage.getItem(INDEX_KEY);
    if (!raw) {
        return [];
    }
    try {
        return JSON.parse(raw) as SaveMeta[];
    } catch {
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
    const existing = index.find((s) => s.name === name);
    const id =
        existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const meta: SaveMeta = { id, name, savedAt: Date.now() };

    try {
        window.localStorage.setItem(DATA_KEY_PREFIX + id, encodeSnapshotToJSON(state));
    } catch (err) {
        throw new Error(
            `Couldn't save "${name}" — browser storage may be full. Try deleting an old save first. (${String(err)})`
        );
    }

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
