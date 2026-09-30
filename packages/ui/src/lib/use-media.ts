import { useSyncExternalStore } from 'react';

const MOBILE = '(max-width: 767px)';

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia(MOBILE);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}

/** Below Tailwind's `md`: phones get cards, infinite scroll and the filter drawer (spec §9.3). */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(MOBILE).matches, () => false);
}
