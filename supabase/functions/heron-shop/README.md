# Mr. Space super-admin bridge

Prepared for review; not deployed. `index.ts` was copied from the live `heron-shop` version 18 during this change. Its only functional change is the admin authorization gate: the existing password OR `mrspaceAdmin(req)` may authorize an allowlisted admin action. Square/checkout/business logic is retained.

`mrspace-auth.ts` sends the forwarded JWT to the fixed Mr. Space `ms_heron_admin_access` RPC. It requires literal `true`, rejects failures/timeouts and never uses a cross-project service-role key. The publishable key in this helper is public. The RPC verifies confirmed user identity, active Auth session and current super-admin membership.

Rollout after approval:

1. Apply Mr. Space `ms/mrspace-control-access.sql` in `tizfdnsjhhepxnqqrzuk`.
2. Deploy this Heron function including the helper to `wvvizyrroqejwrfadbpx` with the existing public API gateway configuration and existing secrets. This function has its own admin action gate; do not change unrelated Square configuration.
3. Deploy the companion Mr. Space `ms-site-control` with JWT verification enabled. It forwards the already verified admin JWT if no legacy password secret exists.
4. Confirm read access, then a disposable write. Reject non-admin and revoked sessions. Existing Heron password login stays available.

`tests/mrspace-auth.mjs` checks strict boolean authorization, fixed endpoint, bad/missing tokens and upstream failure without production requests. Keep this snapshot aligned with the current live function before deployment if another release occurs.
