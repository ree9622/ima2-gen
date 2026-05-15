# Package / Release Hardening Slice

Issue: #67

## ADD `LICENSE`

Full content:

```text
MIT License

Copyright (c) 2026 Jun

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MODIFY `package.json`

Before:

- `files[]` does not include `LICENSE`.
- `lint:pkg` does not require `LICENSE`.
- CI has package smoke but no separate publish dry-run script.

After:

- Add `"LICENSE"` to `files[]`.
- Add `"LICENSE"` to `lint:pkg` required list.
- Add `publish:dry-run` script:

```json
"publish:dry-run": "node scripts/publish-dry-run.mjs"
```

The script intentionally calls `npm publish --dry-run --ignore-scripts` so it
does not re-enter `prepublishOnly`; it also treats the already-published-version
registry response as success because CI often runs on the current published
package version after release.

## MODIFY `.github/workflows/ci.yml`

Add Ubuntu Node 22 publish dry-run step after package lint/smoke.

Do not add install-time hooks.

## MODIFY `scripts/release.sh`

Before:

- Can proceed with staged or dirty worktree.

After:

- At start, refuse staged changes.
- Refuse dirty worktree.
- Print version/tarball intent before publish.

## MODIFY `scripts/release-preview.sh`

Align preflight dirty/staged checks where applicable.

## TESTS

- MODIFY `tests/package-smoke.test.js` or `tests/package-install-smoke.mjs`
  to assert `LICENSE` package inclusion.
