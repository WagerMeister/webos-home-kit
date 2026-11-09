# Build-tool security backports

These archives contain local backports, not publisher-issued releases. They
are used only by the webOS development CLI and are not included in the TV IPK.

- `braces` 3.0.4-security.2 starts from registry 3.0.3 and backports the bounded
  parser and AST traversal from [PR 72](https://github.com/micromatch/braces/pull/72),
  commit `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`. Brace and parenthesis nesting
  is limited to 100; lower caller limits remain effective, larger limits cannot
  remove the cap, and cyclic expansion parents are rejected.
- `sprintf-js` 1.1.4-security.1 starts from registry 1.1.3 and backports
  [PR 239](https://github.com/alexei/sprintf.js/pull/239), commit
  `438195c605fde3e4ff0bb155d2418f7d0171490a`, including its regenerated minified
  browser distribution. Numeric precision is capped at 100; zero significant
  digits become one. Ordinary formatting and string truncation are retained.

These are pinned local backports. The original MIT and BSD-3-Clause licenses
remain inside the archives. Replacing them requires equivalent parser bounds
and formatting behavior, followed by the build-dependency regression checks.

`provenance.json` pins the original registry SHA-512 integrity, every replacement
file's SHA-256, upstream commits and final archive SHA-256. Rebuild and verify:

```sh
python3 vendor/security/build_backports.py
npm ci
npm test
```

`test-build-deps.cjs` checks the installed CLI dependency graph with hostile
patterns, proxy trust inputs and asynchronous precision payloads under Node's
default uncaught-exception policy. It exercises both sprintf entry points and
the two minimatch dependency generations. No vulnerability is suppressed.
