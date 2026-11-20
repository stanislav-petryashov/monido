/** The one way the app leaves for another site (an identity provider, Claude): a seam, tests replace `go`. */
export const browser = {
  go(url: string): void { window.location.assign(url) },
}
