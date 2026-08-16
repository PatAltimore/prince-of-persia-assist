import { Apple2, State } from 'js/apple2';

/**
 * apple2js's top-level Apple2 class already implements Restorable<State>,
 * covering CPU registers, video-mode state, IO (including every card
 * attached to a slot — DiskII's own getState()/setState() covers the
 * loaded disk's nibble data and drive head/track/motor position), MMU, and
 * RAM banks. Confirmed by direct inspection (see docs/SPIKE-NOTES.md) — no
 * custom capture logic was needed, just this thin wrapper plus a
 * JSON-safe encoding for the parts (RAM/disk nibble data) that are
 * Uint8Array and therefore not directly localStorage-able.
 */
export function captureSnapshot(apple2: Apple2): State {
    return apple2.getState();
}

export function restoreSnapshot(apple2: Apple2, state: State): void {
    apple2.setState(state);
}

const UINT8ARRAY_MARKER = '__u8__';

interface EncodedUint8Array {
    [UINT8ARRAY_MARKER]: true;
    data: string;
}

function isEncodedUint8Array(value: unknown): value is EncodedUint8Array {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as Record<string, unknown>)[UINT8ARRAY_MARKER] === true
    );
}

function bytesToBase64(bytes: Uint8Array): string {
    const CHUNK_SIZE = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        chunks.push(
            String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE))
        );
    }
    return btoa(chunks.join(''));
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/**
 * JSON.stringify replacer/reviver pair that transparently round-trips any
 * Uint8Array found at any depth in a State object. Generic on purpose —
 * State's exact nested shape (RAM banks, MMU banks, disk driver data) isn't
 * hand-modeled here so it can't drift out of sync with apple2js internals.
 */
export function encodeSnapshotToJSON(state: State): string {
    return JSON.stringify(state, (_key, value: unknown) => {
        if (value instanceof Uint8Array) {
            const encoded: EncodedUint8Array = {
                [UINT8ARRAY_MARKER]: true,
                data: bytesToBase64(value),
            };
            return encoded;
        }
        return value;
    });
}

export function decodeSnapshotFromJSON(json: string): State {
    return JSON.parse(json, (_key, value: unknown) => {
        if (isEncodedUint8Array(value)) {
            return base64ToBytes(value.data);
        }
        return value;
    }) as State;
}
