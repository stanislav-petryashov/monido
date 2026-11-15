import { fireEvent, screen, waitFor } from '@testing-library/react'
import { resetAuth } from '../../../src/lib/authState'
import { deferred, jsonResponse } from '../../helpers/http'
import { ru, withLanguage } from '../../helpers/i18n'
import { calls, readyButton, renderWizard, stubSetupApi } from '../../helpers/setup'

const preview = () => document.querySelector<HTMLSelectElement>('select')?.value ?? ''
const heading = () => screen.getByRole('heading', {})
const russianOption = () => document.querySelector<HTMLInputElement>('input[type="radio"][value="ru-RU"]')!

beforeEach(() => { sessionStorage.clear(); window.history.replaceState(null, '', '/') })
afterEach(() => { sessionStorage.clear(); resetAuth() })

describe('WelcomeStep', () => {
  it('offers three date orders and switches the page language independently', async () => {
    stubSetupApi()
    renderWizard()
    await waitFor(() => expect(preview()).toBe('dmy'))
    expect(screen.getByRole('combobox', { name: 'Date format' }).querySelectorAll('option')).toHaveLength(3)
    await withLanguage('en-US', async () => {
      fireEvent.click(russianOption())
      await waitFor(() => expect(heading()).toHaveTextContent(ru('data.setup.welcomeTitle')))
      expect(preview()).toBe('dmy')
      expect(russianOption()).toBeChecked()
    })
  })

  it('Start saves the language only when it changed, then goes to the data step', async () => {
    const fetchMock = stubSetupApi()
    const first = renderWizard()
    fireEvent.click(await readyButton('Start'))
    await waitFor(() => expect(heading()).toHaveTextContent('Where shall we start?'))
    expect(calls(fetchMock, 'PUT')).toEqual([])
    first.unmount()

    sessionStorage.clear()
    await withLanguage('en-US', async () => {
      renderWizard()
      await screen.findByRole('button', { name: 'Start' })
      await waitFor(() => expect(preview()).not.toBe(''))
      fireEvent.click(russianOption())
      await waitFor(() => expect(heading()).toHaveTextContent(ru('data.setup.welcomeTitle')))
      fireEvent.click(screen.getByRole('button', { name: ru('data.setup.start') }))
      await waitFor(() => expect(heading()).toHaveTextContent(ru('data.setup.data.title')))
      expect(calls(fetchMock, 'PUT')).toEqual([['PUT', '/api/settings', { language: 'ru-RU' }]])
    })
  })

  it('a failed language write keeps the step with the pick and a toast', async () => {
    stubSetupApi({ answer: { 'PUT /api/settings': () => jsonResponse({ error: { code: 'save_failed' } }, 500) } })
    await withLanguage('en-US', async () => {
      renderWizard()
      await waitFor(() => expect(preview()).not.toBe(''))
      fireEvent.click(russianOption())
      await waitFor(() => expect(heading()).toHaveTextContent(ru('data.setup.welcomeTitle')))
      fireEvent.click(screen.getByRole('button', { name: ru('data.setup.start') }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(heading()).toHaveTextContent(ru('data.setup.welcomeTitle'))
      expect(russianOption()).toBeChecked()
    })
  })

  it('the first run offers Skip for now', async () => {
    stubSetupApi()
    renderWizard()
    expect(await screen.findByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('Skip for now waits for the stored settings: before them the language would look changed and be written', async () => {
    const settings = deferred<Response>()
    const fetchMock = stubSetupApi({ answer: { 'GET /api/settings': () => settings.promise } })
    renderWizard()
    const skip = await screen.findByRole('button', { name: 'Skip for now' })
    expect(skip).toBeDisabled()
    fireEvent.click(skip)
    expect(calls(fetchMock, 'PUT')).toEqual([])
    settings.resolve(jsonResponse({ language: 'en-US', currency: 'USD' }))
    await waitFor(() => expect(skip).toBeEnabled())
  })

  it('Skip for now saves the language and puts skipped', async () => {
    const fetchMock = stubSetupApi()
    await withLanguage('en-US', async () => {
      window.history.replaceState(null, '', '/setup')
      renderWizard()
      await waitFor(() => expect(preview()).not.toBe(''))
      fireEvent.click(russianOption())
      await waitFor(() => expect(heading()).toHaveTextContent(ru('data.setup.welcomeTitle')))
      fireEvent.click(screen.getByRole('button', { name: ru('data.setup.skip') }))
      await waitFor(() => expect(window.location.pathname).toBe('/'))
    })
    const sent = calls(fetchMock).filter(([method, url]) => method === 'PUT' || url === '/api/auth')
    expect(sent).toEqual([
      ['PUT', '/api/settings', { language: 'ru-RU' }],
      ['PUT', '/api/setup', { state: 'skipped' }],
      ['GET', '/api/auth', undefined],
    ])
  })

  it('a failed PUT /api/setup on Skip keeps the wizard with a notification: no navigation, no auth re-read', async () => {
    window.history.replaceState(null, '', '/setup')
    const fetchMock = stubSetupApi({ answer: { 'PUT /api/setup': () => jsonResponse({ error: { code: 'save_failed' } }, 500) } })
    renderWizard()
    fireEvent.click(await readyButton('Skip for now'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save')
    expect(calls(fetchMock, 'PUT')).toEqual([['PUT', '/api/setup', { state: 'skipped' }]])
    expect(calls(fetchMock).filter(([, url]) => url === '/api/auth')).toEqual([])
    expect(window.location.pathname).toBe('/setup')
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('a re-run shows the "again" title and intro', async () => {
    stubSetupApi({ setup: { state: 'done' } })
    renderWizard({ again: true })
    await waitFor(() => expect(heading()).toHaveTextContent('Set up your finances'))
    expect(screen.getByText('Review your current settings at each step.')).toBeInTheDocument()
    // a re-run has nothing to skip: `skipped` would undo the finished setup
    await screen.findByRole('button', { name: 'Start' })
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
  })
})

it.each(['Start', 'Skip for now'])('%s clears the bootstrap carry even when the chosen language already matches the family', async action => {
  sessionStorage.setItem('fc.bootstrapLanguage', 'en-US')
  const fetchMock = stubSetupApi()
  renderWizard()
  fireEvent.click(await readyButton(action))
  await waitFor(() => expect(sessionStorage.getItem('fc.bootstrapLanguage')).toBeNull())
  expect(calls(fetchMock, 'PUT').filter(([, url]) => url === '/api/settings')).toEqual([])
})

it('clears the bootstrap carry after saving an explicit Welcome language', async () => {
  sessionStorage.setItem('fc.bootstrapLanguage', 'ru-RU')
  const fetchMock = stubSetupApi()
  await withLanguage('ru-RU', async () => {
    renderWizard()
    fireEvent.click(await readyButton(ru('data.setup.start')))
    await waitFor(() => expect(sessionStorage.getItem('fc.bootstrapLanguage')).toBeNull())
    expect(calls(fetchMock, 'PUT')).toContainEqual(['PUT', '/api/settings', { language: 'ru-RU' }])
  })
})

it('saves the date format and restores it when Welcome is reopened', async () => {
  const fetchMock = stubSetupApi()
  const first = renderWizard()
  const select = await screen.findByRole('combobox', { name: 'Date format' })
  await waitFor(() => expect(select).toBeEnabled())
  fireEvent.change(select, { target: { value: 'ymd' } })
  await waitFor(() => expect(select).toHaveValue('ymd'))
  expect(calls(fetchMock, 'PUT')).toContainEqual(['PUT', '/api/settings', { dateFormat: 'ymd' }])
  first.unmount()
  renderWizard()
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Date format' })).toHaveValue('ymd'))
})
