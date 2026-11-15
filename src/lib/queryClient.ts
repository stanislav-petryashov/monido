import { QueryClient } from '@tanstack/react-query'

/** The app's query cache (App.tsx). */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000, retry: 1 } },
})
