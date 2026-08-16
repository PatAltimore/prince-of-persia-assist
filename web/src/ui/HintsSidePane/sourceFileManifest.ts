/**
 * Curated list of the "01 POP Source/Source" files that Code Museum has
 * explainer articles for (confirmed 1:1 against its live file tree and
 * against build-tooling/pop-build's own source directory — see
 * docs/SPIKE-NOTES.md). Not auto-generated from the filesystem: Code
 * Museum's coverage is what determines this list, not the source tree.
 */
export interface SourceFileEntry {
    filename: string;
    description: string;
}

export const SOURCE_FILE_MANIFEST: SourceFileEntry[] = [
    { filename: 'MASTER.S', description: 'Game flow controller: boot, attract mode, save/load, level sequencing' },
    { filename: 'TOPCTRL.S', description: 'Top-level control loop — the main game state machine and level sequencing' },
    { filename: 'BOOT.S', description: 'The two-stage disk boot loader with 128K memory check' },
    { filename: 'AUTO.S', description: 'Attract mode — the demo loop that plays while waiting for a player' },
    { filename: 'CTRL.S', description: 'Player input and game control logic' },
    { filename: 'CTRLSUBS.S', description: 'Controller subroutine helpers for joystick and keyboard input' },
    { filename: 'SPECIALK.S', description: 'Special key handlers — cheat codes and developer debug functions' },
    { filename: 'MOVER.S', description: 'Physics engine — gravity, momentum, and movement resolution' },
    { filename: 'MOVEDATA.S', description: 'Movement data tables — numeric constants defining walk, run, jump, and fall physics values' },
    { filename: 'COLL.S', description: 'Collision detection between the prince and the dungeon environment' },
    { filename: 'FRAMEADV.S', description: 'Frame advance — the per-frame logic that drives the animation system' },
    { filename: 'SEQTABLE.S', description: 'The animation state machine — every movement rotoscoped from film' },
    { filename: 'SEQDATA.S', description: 'Animation sequence data — packed byte streams driving every character animation state' },
    { filename: 'FRAMEDEF.S', description: 'Animation frame definitions — maps frame numbers to sprite data for every character animation' },
    { filename: 'GRAFIX.S', description: 'The graphics engine — page-flipping and sprite blitting on Apple IIe hardware' },
    { filename: 'HIRES.S', description: 'Hi-res graphics primitives — the Apple IIe 280×192 bitmap routines' },
    { filename: 'HRPARAMS.S', description: 'Hi-res display parameters — configuration constants for the Apple IIe 280×192 graphics mode' },
    { filename: 'HRTABLES.S', description: 'Hi-res lookup tables — precomputed byte-address tables for fast Apple IIe pixel access' },
    { filename: 'GAMEBG.S', description: 'Background renderer — draws the dungeon tile backdrop from room layout data' },
    { filename: 'BGDATA.S', description: 'Background tile bitmaps — the raw graphics data for every dungeon wall, floor, and gate tile' },
    { filename: 'SOUND.S', description: 'The complete sound engine — twenty sounds, one speaker, zero compromises' },
    { filename: 'SOUNDNAMES.S', description: 'Sound name equates — symbolic names mapping each of the twenty sound effects to its ID' },
    { filename: 'UNPACK.S', description: 'Data decompressor — unpacking compressed level and animation data' },
    { filename: 'SUBS.S', description: 'Core subroutine library — shared utilities used throughout the engine' },
    { filename: 'TABLES.S', description: 'Global lookup tables — shared precomputed tables referenced throughout the engine' },
    { filename: 'MISC.S', description: 'Miscellaneous utility routines' },
    { filename: 'EQ.S', description: 'Global equates — symbolic constants for tile types, collision flags, and object IDs' },
    { filename: 'GAMEEQ.S', description: 'Game-logic equates — numeric constants for game states, frame flags, and event codes' },
    { filename: 'VERSION.S', description: 'Version string — game version identifier and copyright notice burned into the binary' },
];
