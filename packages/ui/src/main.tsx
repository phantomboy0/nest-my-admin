import '@fontsource-variable/geist';
import '@fontsource-variable/vazirmatn';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AdminLayout } from '@/app/admin-layout';
import { FormPage } from '@/app/form-page';
import { HomePage } from '@/app/home-page';
import { ListPage } from '@/app/list-page';
import { NotFound } from '@/app/not-found';
import { LocaleProvider } from '@/i18n';
import { runtimeConfig } from '@/lib/config';
import { applyBranding, applyTheme, followSystemTheme, readTheme } from '@/lib/theme';

document.title = runtimeConfig.title;
// Before the first render, so a dark or branded page never flashes light and unbranded.
applyTheme(readTheme());
applyBranding(runtimeConfig.branding);
followSystemTheme(readTheme);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

const router = createBrowserRouter(
  [
    {
      element: <AdminLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: ':resource', element: <ListPage /> },
        { path: ':resource/new', element: <FormPage mode="create" /> },
        { path: ':resource/:id', element: <FormPage mode="edit" /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: runtimeConfig.basePath },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider locales={runtimeConfig.locales} fallback={runtimeConfig.locale}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LocaleProvider>
  </StrictMode>,
);
