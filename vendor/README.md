# Vendored scripts

| File | Package | Version | Source | SRI |
|---|---|---|---|---|
| `supabase-js-2.118.0.umd.js` | @supabase/supabase-js | 2.118.0 | npm tarball `dist/umd/supabase.js` (MIT, see `supabase-js-LICENSE`) | `sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK` |

The Admin pages load this file from the site itself instead of `cdn.jsdelivr.net/npm/@supabase/supabase-js@2`, so a new
release or a CDN problem cannot change the code that runs while an organizer is signed in.

To update: `npm pack @supabase/supabase-js@<version>`, copy `package/dist/umd/supabase.js` here under the new version name,
recompute the hash with `openssl dgst -sha384 -binary <file> | openssl base64 -A`, update both `<script>` tags, and run the tests.
