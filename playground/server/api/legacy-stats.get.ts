// Intentionally a plain Nitro route with no `endpoint` export.
//
// It demonstrates incremental adoption: this route is skipped by nuxt-endpoints
// entirely — no validation is added, it does not appear on `$endpoint` or in
// the OpenAPI document, and it keeps working through plain `$fetch`.
export default defineEventHandler(() => {
  return {
    totalUsers: 4,
    uptimeSeconds: Math.floor(process.uptime()),
  }
})
