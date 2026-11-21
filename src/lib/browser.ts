/** The one way the app leaves for another site (an identity provider, Claude) or reloads itself: a seam, tests replace them. */
export const browser = {
  go(url: string): void { window.location.assign(url) },
  reload(): void { window.location.reload() },
}
