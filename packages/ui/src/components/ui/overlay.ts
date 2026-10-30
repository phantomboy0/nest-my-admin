/**
 * The one look of everything that blocks the page behind it (Radix dialogs, the mobile menu, blocking alerts):
 * the app dims and blurs, so the thing in front is what people read. Theme tokens, so dark mode follows.
 */
export const OVERLAY_CLASS = 'fixed inset-0 z-40 bg-background/40 backdrop-blur-sm';

/** The same, with a fade-in that `prefers-reduced-motion` switches off (tw-animate-css, motion-safe). */
export const OVERLAY_ANIMATED_CLASS = `${OVERLAY_CLASS} motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150`;
