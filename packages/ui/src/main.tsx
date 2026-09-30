import '@fontsource-variable/geist';
import '@fontsource-variable/vazirmatn';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AccountPage } from '@/app/account-page';
import { AdminLayout } from '@/app/admin-layout';
import { LoginPage } from '@/app/login-page';
import { FormPage } from '@/app/form-page';
import { GroupPage } from '@/app/group-page';
import { HomePage } from '@/app/home-page';
import { ListPage } from '@/app/list-page';
import { NotFound } from '@/app/not-found';
import { LocaleProvider } from '@/i18n';
import { runtimeConfig } from '@/lib/config';
import { setSignedOutHandler } from '@/lib/session';
import { applyBranding, applyTheme, followSystemTheme, readTheme } from '@/lib/theme';

document.title = runtimeConfig.title;
// Before the first render, so a dark or branded page never flashes light and unbranded.
applyTheme(readTheme());
applyBranding(runtimeConfig.branding);
followSystemTheme(readTheme);

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });

const router = createBrowserRouter(
  [
    { path: 'login', element: <LoginPage /> },
    {
      element: <AdminLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'account', element: <AccountPage /> },
        { path: 'g/:group', element: <GroupPage /> },
        { path: ':resource', element: <ListPage /> },
        { path: ':resource/new', element: <FormPage mode="create" /> },
        { path: ':resource/:id', element: <FormPage mode="edit" /> },
        { path: '*', element: <NotFound /> },
      ],
    },
  ],
  { basename: runtimeConfig.basePath },
);

// A session that ends while the admin is open (expired, revoked elsewhere): drop what this user saw, then log in again.
setSignedOutHandler(() => {
  const { pathname, search } = router.state.location;
  if (pathname === '/login') return;
  queryClient.clear();
  void router.navigate(`/login?${new URLSearchParams({ next: pathname + search })}`, { replace: true });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider locales={runtimeConfig.locales} fallback={runtimeConfig.locale}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </LocaleProvider>
  </StrictMode>,
);
