/**
 * Decision D17 (RET-002): there is no weekly approval. The owner starts work
 * himself ("Plan next 15 days", "Create email"). The old weekly copy review
 * answers the app's Not found page with a real 404, like the designer routes
 * (RET-001). Its code and tables stay; nothing links to it.
 */
const retired = /^\/copy-review(?:\/|$)/

export function isRetiredApprovalPath(pathname: string) {
  return retired.test(pathname.toLowerCase())
}
