import type { AdminRuntimeConfig } from '@nest-my-admin/core/contract';

declare global {
  interface Window {
    __NMA__?: AdminRuntimeConfig;
  }
}

/** Injected by @nest-my-admin/core; the fallback is for `vite` dev mode (proxied to a local Nest app). */
export const runtimeConfig: AdminRuntimeConfig = window.__NMA__ ?? {
  basePath: '/',
  apiBase: '/admin/api',
  title: 'Admin (dev)',
};
