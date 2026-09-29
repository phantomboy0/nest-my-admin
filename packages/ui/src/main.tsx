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
import { runtimeConfig } from '@/lib/config';

document.title = runtimeConfig.title;

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
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
