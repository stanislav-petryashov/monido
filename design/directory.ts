import copy from './locales/ru-RU.json'

export const directory: Record<string, Record<string, string>> = copy.directory

export const relatedEntries: Record<string, string> = {
  '.chip': 'Chip', '.section-label': 'SectionLabel', '.admin-select': 'Select',
  '.select': 'Select', DisclosureGroup: 'Disclosure', SignButton: 'NumberInput',
  AdminReadNotice: 'PageError', SetupLoadError: 'PageError',
}
