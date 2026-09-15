/**
 * Development-only fixture switch.
 *
 * Production builds never serve fixture data — even if AXIS_USE_DEV_FIXTURE is
 * accidentally set true in a production environment.
 *
 * Non-production:
 * - Explicit AXIS_USE_DEV_FIXTURE=true|1 → on
 * - Explicit AXIS_USE_DEV_FIXTURE=false|0 → off
 * - Unset → on in development (local DX)
 *
 * The profile layer additionally gates on the reference wallet address.
 */
export function isDevFixtureEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;

  const raw = process.env.AXIS_USE_DEV_FIXTURE?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return true;
}
