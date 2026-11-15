// The theme before the first paint, otherwise dark would flash light. The logic mirrors src/lib/themeState.ts:
// the per-device choice 'ff-theme' (light | dark), otherwise (System) the device's prefers-color-scheme.
// An external file, not an inline script: the CSP allows scripts only from the own origin (script-src 'self').
(function () {
  var mode = 'system'
  try { mode = localStorage.getItem('ff-theme') || 'system' } catch (e) { /* storage is blocked: System */ }
  var dark = mode === 'dark' || (mode !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  // Without this the browser paints the canvas with the system theme until the CSS loads (meta color-scheme).
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
})()
