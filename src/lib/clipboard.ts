/** Copies text to the clipboard; true on success. Without the Clipboard API (http, old browsers, refusal) it goes through a hidden field. */
export async function copyText(text: string, mayContinue: () => boolean = () => true): Promise<boolean> {
  if (!mayContinue()) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // no permission: try the fallback
  }
  return mayContinue() ? legacyCopy(text) : false
}

function legacyCopy(text: string): boolean {
  // The field takes focus: remember where it was and give it back, or keyboard focus is lost to the body.
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.focus()
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    previous?.focus()
  }
}
