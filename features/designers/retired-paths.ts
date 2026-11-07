/**
 * Decision D3 (RET-001): every designer route, and the admin Designers
 * page, is retired. The proxy answers these with the app's Not found page
 * and a real 404 before any page starts streaming (a page that calls
 * notFound() under a loading screen can only send status 200).
 */
const retired = /^\/(?:designer|admin\/designers)(?:\/|$)/

export function isRetiredDesignerPath(pathname: string) {
  return retired.test(pathname.toLowerCase())
}
