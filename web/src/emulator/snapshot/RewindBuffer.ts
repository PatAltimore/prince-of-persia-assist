import { State } from 'js/apple2';

export interface RewindEntry {
    timestamp: number;
    state: State;
    /** PNG data URL, see thumbnail.ts. */
    thumbnail: string;
}

/**
 * Fixed-size in-memory ring buffer of timestamped snapshots for scrub-style
 * rewind. Not persisted — only needs to survive the current session.
 *
 * Sized by wall-clock time, not frame count: a raw (unencoded) snapshot for
 * this game measures ~451KB (mostly the ~233KB loaded disk image, plus
 * ~166KB of RAM/aux-RAM — see docs/SPIKE-NOTES.md for the full breakdown
 * and the memory-budget reasoning behind the interval chosen in main.ts).
 * Frame-counting would tie rewind depth to actual fps, which varies with
 * device/tab-visibility (see the rAF-throttling notes elsewhere in
 * SPIKE-NOTES); wall-clock timestamps keep "5 minutes of rewind" and "jump
 * back 10 seconds" accurate regardless. Each entry also carries a small
 * thumbnail (a few KB, negligible next to the ~451KB snapshot itself) so
 * the scrubber UI can preview a position before committing to it.
 */
export class RewindBuffer {
    private entries: RewindEntry[] = [];

    constructor(private readonly capacity: number) {}

    push(state: State, thumbnail: string, timestamp: number = Date.now()): void {
        this.entries.push({ timestamp, state, thumbnail });
        if (this.entries.length > this.capacity) {
            this.entries.shift();
        }
    }

    get length(): number {
        return this.entries.length;
    }

    /** Snapshot at `index`, 0 = oldest, length-1 = newest. */
    at(index: number): State | undefined {
        return this.entries[index]?.state;
    }

    timestampAt(index: number): number | undefined {
        return this.entries[index]?.timestamp;
    }

    thumbnailAt(index: number): string | undefined {
        return this.entries[index]?.thumbnail;
    }

    get newestTimestamp(): number | undefined {
        return this.entries[this.entries.length - 1]?.timestamp;
    }

    /**
     * Index of the snapshot closest to (at or before) `secondsAgo` seconds
     * before the newest entry. Returns the oldest available entry if the
     * buffer doesn't have enough history yet, or undefined if empty.
     */
    indexSecondsAgo(secondsAgo: number): number | undefined {
        if (this.entries.length === 0) {
            return undefined;
        }
        const target = this.newestTimestamp! - secondsAgo * 1000;
        for (let i = this.entries.length - 1; i >= 0; i--) {
            if (this.entries[i].timestamp <= target) {
                return i;
            }
        }
        return 0;
    }

    clear(): void {
        this.entries = [];
    }
}

/**
 * Drives periodic snapshotting from the emulator's per-frame tick hook.
 * Call `onTick()` every frame; it pushes a new snapshot once at least
 * `intervalMs` of wall-clock time has passed since the last one.
 *
 * The actual capture work (~11ms measured: ~1ms to copy state, ~10ms for
 * PNG-encoding the thumbnail) is deferred to a separate macrotask
 * (`setTimeout(..., 0)`) rather than run synchronously inside `onTick()`.
 * `onTick()` is called from the same per-frame callback that drives audio
 * sample generation (`Apple2IO.tick()`) and schedules the next
 * `requestAnimationFrame` (see apple2.ts's `run()`), so ~11ms of
 * synchronous work there — more than half of a 60fps frame's ~16.7ms
 * budget — delayed the next frame's audio generation enough to be an
 * audible glitch every single interval. Reported via playtesting as
 * "pulsing... not steady... a stutter", which lines up exactly with a
 * hitch recurring on the snapshot interval. Deferring lets the current
 * frame (and the next rAF scheduling) complete first; the snapshot lands
 * a macrotask later, a few ms of skew that's irrelevant at 5-second
 * granularity.
 */
export class RewindRecorder {
    private lastSnapshotAt = 0;
    private capturePending = false;

    constructor(
        private readonly buffer: RewindBuffer,
        private readonly intervalMs: number,
        private readonly captureFn: () => State,
        private readonly thumbnailFn: () => string
    ) {}

    onTick(): void {
        const now = Date.now();
        if (now - this.lastSnapshotAt >= this.intervalMs && !this.capturePending) {
            this.lastSnapshotAt = now;
            this.capturePending = true;
            setTimeout(() => {
                this.buffer.push(this.captureFn(), this.thumbnailFn(), now);
                this.capturePending = false;
            }, 0);
        }
    }
}
