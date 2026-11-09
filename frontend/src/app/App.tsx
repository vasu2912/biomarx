import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/ui/primitives'
import { Shell } from './Shell'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})

const page = (load: () => Promise<{ default: React.ComponentType }>) => () => load().then((m) => ({ Component: m.default }))

const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    children: [
      { index: true, lazy: page(() => import('@/features/overview')) },
      { path: 'sleep', lazy: page(() => import('@/features/sleep')) },
      { path: 'rhythm', lazy: page(() => import('@/features/rhythm')) },
      { path: 'heart', lazy: page(() => import('@/features/heart')) },
      { path: 'patterns', lazy: page(() => import('@/features/patterns')) },
      { path: 'mobility', lazy: page(() => import('@/features/mobility')) },
      { path: 'ecg', lazy: page(() => import('@/features/ecg')) },
      { path: 'import', lazy: page(() => import('@/features/import')) },
      { path: '*', lazy: page(() => import('./NotFound')) },
    ],
  },
])

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
        <Toaster theme="dark" position="bottom-right" toastOptions={{ className: '!bg-raised !border-hairline-2 !text-ink' }} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
