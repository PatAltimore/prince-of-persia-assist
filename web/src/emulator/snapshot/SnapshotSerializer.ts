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

// A plain string used as a "marker" property name, so `isEncodedUint8Array`
// below can recognize an encoded array by checking for this one specific
// key. Declaring it as a constant (rather than writing the literal string
// '__u8__' in two different places) means there's no risk of a typo
// making the encoder and decoder quietly disagree.
const UINT8ARRAY_MARKER = '__u8__';

// `[UINT8ARRAY_MARKER]: true` below is a "computed property name" — the
// square brackets mean "use the *value* of this expression as the
// property's key," rather than a literal key named `UINT8ARRAY_MARKER`.
// Since `UINT8ARRAY_MARKER` is `'__u8__'`, this interface describes an
// object shaped like `{ __u8__: true, data: string }`.
interface EncodedUint8Array {
    [UINT8ARRAY_MARKER]: true;
    data: string;
}

// The return type `value is EncodedUint8Array` (rather than plain
// `boolean`) makes this a "type predicate" / type guard: TypeScript
// understands that if this function returns true, `value` really is an
// `EncodedUint8Array` from that point on in the calling code — see
// `decodeSnapshotFromJSON` below, where `value.data` is accessed right
// after this check with no further casting needed. Without a type
// predicate, the function would still work at runtime, but the compiler
// wouldn't narrow `value`'s type afterward.
function isEncodedUint8Array(value: unknown): value is EncodedUint8Array {
    return (
        typeof value === 'object' &&
        value !== null &&
        // `value` is only known as `unknown` here (deliberately the most
        // restrictive type — "could be anything, prove it before using
        // it") — this cast to `Record<string, unknown>` ("an object with
        // string keys, values of unknown type") is what allows indexing
        // into it with `[UINT8ARRAY_MARKER]` at all, since `unknown`
        // itself doesn't support property access.
        (value as Record<string, unknown>)[UINT8ARRAY_MARKER] === true
    );
}

// `Uint8Array` is a "typed array": a fixed-length, fixed-type view over
// raw binary data (each element is literally one byte, 0-255) — as
// opposed to a regular JS array, which can hold anything and resizes
// freely. It's what apple2js uses to represent RAM, disk images, etc.,
// since those are naturally raw bytes. `btoa`/`atob` (below) are the
// browser's built-in base64 encode/decode functions, but they only
// operate on strings, not typed arrays — this function bridges the gap.
function bytesToBase64(bytes: Uint8Array): string {
    // Processed in chunks rather than all at once: `String.fromCharCode(...bytes)`
    // ("spread" the whole typed array as individual arguments) would work
    // for a small array, but passing hundreds of thousands of individual
    // arguments to a function can exceed the JS engine's call-stack size —
    // exactly the situation here, since a full snapshot's RAM banks are
    // tens of thousands of bytes each. Chunking at a fixed size sidesteps
    // that limit.
    const CHUNK_SIZE = 0x8000;
    const chunks: string[] = [];
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        // `.subarray(start, end)` returns a view over that byte range
        // (no copying) — spreading each smaller chunk into
        // `String.fromCharCode` stays well under the argument-count limit.
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
    // JSON has no concept of binary data or typed arrays — only strings,
    // numbers, booleans, null, plain objects, and arrays — so a
    // `Uint8Array` anywhere inside `state` needs converting to something
    // JSON *can* represent before this can be saved as text (see
    // SaveGameStore.ts, which stores this string in localStorage).
    // `JSON.stringify`'s second argument, the "replacer," is a function
    // JSON.stringify calls for *every* key/value pair it's about to
    // serialize, anywhere in the (possibly deeply nested) object — giving
    // this code a chance to swap out just the Uint8Arrays for a
    // JSON-friendly `{ __u8__: true, data: "<base64>" }` placeholder
    // object, and leave everything else untouched.
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
    // `JSON.parse`'s second argument, the "reviver," is the mirror image
    // of the replacer above — called for every key/value pair as the
    // JSON text is parsed back into objects, letting this code recognize
    // the `{ __u8__: true, ... }` placeholders and turn them back into
    // real `Uint8Array`s instead of leaving them as plain objects.
    return JSON.parse(json, (_key, value: unknown) => {
        if (isEncodedUint8Array(value)) {
            return base64ToBytes(value.data);
        }
        return value;
    // `as State` here is a type assertion, same idea as the ones in
    // EmulatorController.ts: `JSON.parse`'s return type is always the
    // very general `any`, so this tells TypeScript to treat the result as
    // the more specific `State` type this function promises to return —
    // there's no runtime check backing this one up, just trust that the
    // reviver logic above reconstructs a valid `State`.
    }) as State;
}
