# ophir-workflows

Reusable GitHub Actions workflows. One source of truth so repos don't each carry
a CI copy that drifts.

## `ci-node.yml` — the standard CI gate

Runs the caller repo's own `ci` script (typecheck + the full vitest suite,
including any real-Postgres **pglite** integration tests). It's the visible check
and the PR gate; the *binding* deploy stop lives in each caller's `vercel.json`
(`buildCommand: npm run ci && npm run build`).

### Use it

In the caller repo, `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  push:
    branches: [main, staging]
  pull_request:
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  verify:
    uses: samlawal/ophir-workflows/.github/workflows/ci-node.yml@main
    # with:
    #   node-version: "20"   # optional, defaults to 20
```

### The caller repo must have

- a `ci` script, e.g. `"ci": "npm run typecheck && npm run test"`
- a committed `package-lock.json` (for `npm ci`)
- a **hermetic** suite — pin `NODE_ENV=test` (and any dev secret the suite
  assumes) in `vitest.config` so it passes identically in CI *and* inside the
  Vercel build, which forces `NODE_ENV=production` and injects real secrets.

Pin `@main` for now; cut a tag (e.g. `@v1`) once the contract is stable.
