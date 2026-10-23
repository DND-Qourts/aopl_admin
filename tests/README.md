# Admin portal tests

Browser tests run the real `index.html` in Chromium (Playwright). Supabase auth and the
`admin-access` Edge Function are replaced by in-test mocks, so nothing here can reach the
production project. Any request to an unmocked host is aborted and fails the test.

    npm install          # installs playwright (devDependency)
    npm test

Environment: set `CHROMIUM_PATH` to a Chromium binary if Playwright's own download is not available.

`admin-users-xss.test.cjs` covers audit finding S-1 (stored XSS in Admin Users / Role Management).
`registration-review.test.cjs` pins the review screen for rated players (written before the NR work).
`nr-review.test.cjs` covers NR display, NR confirmation, exact cap arithmetic and strict rating entry.
`fixtures.cjs` holds the synthetic registrations. No real participant data is used anywhere.
