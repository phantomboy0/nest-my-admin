import type { AdminRuntimeConfig } from '@nest-my-admin/core/contract';

/** Reads the inert JSON block @nest-my-admin/core injects into index.html (an inline script would break under a strict CSP). */
function readRuntimeConfig(): AdminRuntimeConfig {
  const text = document.getElementById('nma-config')?.textContent;
  if (text) return JSON.parse(text) as AdminRuntimeConfig;
  // `vite` dev mode is proxied to a local Nest app and has no injected config.
  if (import.meta.env.DEV) return { basePath: '/', apiBase: '/admin/api', title: 'Admin (dev)', locale: 'en', locales: ['en', 'fa'], branding: {} };
  throw new Error('nest-my-admin: runtime config missing');
}

export const runtimeConfig: AdminRuntimeConfig = readRuntimeConfig();
