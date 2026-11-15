import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { FamilySettings } from '../domain/api'
import { applyFamilyLanguage, currentLanguage, loadLanguageNames, t } from '../i18n/client'
import { isLanguage, type Language } from '../i18n/languages'
import { apiSend } from './api'
import { useToast } from './notifyState'
import { refreshSnapshot } from './useFinanceData'

import { applyDateFormat } from './dateFormat'

import { settingsQuery } from './familySettingsQuery'

const KEY = settingsQuery.queryKey

/** The family's language and currency (GET /api/settings). */
export function useFamilySettings() {
  return useQuery(settingsQuery)
}

/** The family language once the settings are read and hold a known one, else null */
export function useFamilyLanguage(): Language | null {
  const { data } = useFamilySettings()
  return data && isLanguage(data.language) ? data.language : null
}

/** The family currency once the settings are read, else '' */
export function useFamilyCurrency(): string {
  const { data } = useFamilySettings()
  return typeof data?.currency === 'string' ? data.currency : ''
}

/** Each language by its own name; empty until the locales are loaded (a failure is logged and the codes stand in) */
export function useLanguageNames(): Partial<Record<Language, string>> {
  const [names, setNames] = useState<Partial<Record<Language, string>>>({})
  useEffect(() => {
    loadLanguageNames().then(setNames).catch((e: unknown) => console.error('[language] names failed to load', e))
  }, [])
  return names
}

/**
 * After a write that changed the family settings outside the settings form (a revert in Change history): reads them
 * again, switches the UI to the stored language and refreshes the snapshot (its default currency). A failure only logs:
 * the write itself succeeded.
 */
export async function reloadFamilySettings(queryClient: QueryClient): Promise<void> {
  try {
    const settings = await queryClient.fetchQuery({ ...settingsQuery, staleTime: 0 })
    if (settings.language !== currentLanguage()) await applyFamilyLanguage(settings.language)
    await refreshSnapshot(queryClient)
  } catch (e) {
    console.error('[settings] reload failed', e)
  }
}

/**
 * Saves one or both family settings (PUT /api/settings) and tells the person. On success the settings are read again,
 * the snapshot is refreshed (its default currency may have changed) and the UI switches to a new language at once.
 */
export function useSaveFamilySetting() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (patch: Partial<FamilySettings>) => apiSend<FamilySettings>('/api/settings', 'PUT', patch),
    onSuccess: async (saved, patch) => {
      applyDateFormat(saved.dateFormat)
      // the language first: the toast is worded in the new one (`t` is the live instance, not a render's copy).
      // The setting is saved either way: a locale that fails to load only leaves the language as it was.
      if (patch.language !== undefined) {
        await applyFamilyLanguage(saved.language).catch((e: unknown) => console.error('[language] switch failed', e))
      }
      toast.success(t('data.params.familySaved'))
      await Promise.all([queryClient.invalidateQueries({ queryKey: KEY }), refreshSnapshot(queryClient)])
    },
    onError: e => toast.error(t('data.common.saveFailed'), e),
  })
}
