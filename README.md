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

## `fix-gate.yml` — the deterministic gate for `fix/<id>` branches

No AI. On every push to a `fix/**` branch it:

1. lists the files the branch changed against the base branch and classifies them
   with the caller's own **`.ophir/protected.json`**:
   - **forbidden** — the branch may never change these (workflows, deploy config,
     dependencies, env files, the rules file itself) → the gate **fails**
   - **protected** — sensitive areas (money, accounts, data, shared layout) →
     allowed, but never shipped unattended
   - **low** — only unprotected files changed
2. runs the caller's full `ci` script;
3. writes the verdict to the run summary and, if `OPHIR_PIPELINE_SECRET` is set,
   sends it as a **signed** report (HMAC-SHA256 of `timestamp.body`; the receiver
   rejects bad signatures and anything older than 5 minutes).

A repo with no rules file never gets a `low` verdict.

### Use it

`.github/workflows/fix-gate.yml` in the caller:

```yaml
name: Fix gate
on:
  push:
    branches: ['fix/**']
concurrency:
  group: fix-gate-${{ github.ref }}
  cancel-in-progress: true
jobs:
  gate:
    uses: samlawal/ophir-workflows/.github/workflows/fix-gate.yml@main
    secrets:
      OPHIR_PIPELINE_SECRET: ${{ secrets.OPHIR_PIPELINE_SECRET }}
    # with:
    #   base-branch: main
```

`.ophir/protected.json`:

```json
{
  "forbidden": [".github/**", "vercel.json", "package.json", "package-lock.json", ".env*", ".ophir/**"],
  "protected": [
    { "area": "money", "globs": ["app/api/checkout/**", "lib/stripe.ts"] },
    { "area": "data",  "globs": ["**/schema.ts", "drizzle/**"] }
  ]
}
```

Globs: `**` spans directories, `*` stays within one, `?` is one character, and a
pattern matches the whole repo-relative path. Tests: `node --test scripts/fix-gate/fix-gate.test.mjs`.
