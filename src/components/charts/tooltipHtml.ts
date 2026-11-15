/**
 * ECharts puts a tooltip formatter's string into the page as HTML: every value interpolated into it — a name, a label,
 * a formatted amount (a currency code is stored text) — goes through escapeHtml. Only ECharts' own `marker` is HTML.
 * The values land in element text, never in an attribute, so `&`, `<` and `>` are what must not reach the page raw.
 */
export function escapeHtml(text: string | number): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
