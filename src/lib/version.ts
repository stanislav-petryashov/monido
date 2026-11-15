import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './api'

export interface VersionInfo { version: string; latest: string | null; behind: boolean }

/** The running version and whether a newer image exists; asked once an hour (the server checks the registry once a day). */
export const useVersion = () => useQuery({
  queryKey: ['version'],
  queryFn: () => apiFetch<VersionInfo>('/api/version'),
  staleTime: 3600_000,
})
