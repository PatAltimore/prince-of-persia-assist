/** Thumbnail pixel dimensions — a quarter of the 592x416 game canvas. */
export const THUMBNAIL_WIDTH = 148;
export const THUMBNAIL_HEIGHT = 104;

let offscreen: HTMLCanvasElement | undefined;

/**
 * Downscales the live game canvas into a small PNG data URL for use as a
 * rewind-buffer thumbnail. Reuses one offscreen canvas across calls rather
 * than allocating a new one every snapshot (every 5s, but still — no need
 * to churn DOM nodes for something called this often over a session).
 *
 * PNG (not JPEG): this is flat-color, high-contrast Apple II hi-res
 * graphics, not photographic content — PNG compresses it well and stays
 * lossless at this tiny size, so there's no real tradeoff to make here.
 */
export function captureThumbnail(canvas: HTMLCanvasElement): string {
    if (!offscreen) {
        offscreen = document.createElement('canvas');
        offscreen.width = THUMBNAIL_WIDTH;
        offscreen.height = THUMBNAIL_HEIGHT;
    }
    const ctx = offscreen.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
    return offscreen.toDataURL('image/png');
}
