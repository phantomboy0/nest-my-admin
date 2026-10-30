/**
 * The one look of everything that blocks the page behind it (Radix dialogs, the mobile menu, blocking alerts):
 * the app dims and blurs, so the thing in front is what people read. A real dim in both themes (a background-coloured wash would only whiten light mode), deeper in dark.
 */
export const OVERLAY_CLASS = 'fixed inset-0 z-40 bg-black/40 backdrop-blur-sm dark:bg-black/60';

/** The same, with a fade-in that `prefers-reduced-motion` switches off (tw-animate-css, motion-safe). */
export const OVERLAY_ANIMATED_CLASS = `${OVERLAY_CLASS} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150`;
