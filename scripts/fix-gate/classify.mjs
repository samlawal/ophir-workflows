// Fix-gate classifier — decides, WITHOUT any AI, how risky a fix branch is from
// the files it changed. Pure + dependency-free so it runs on any runner.
//
// Rules come from the caller repo's own `.ophir/protected.json`:
//   {
//     "forbidden": ["<glob>", ...],            // a fix branch may NEVER touch these
//     "protected": [{ "area": "money", "globs": ["<glob>", ...] }, ...]
//   }
// Verdict:
//   forbidden  — touched a forbidden file → the gate FAILS
//   protected  — touched a protected area → may never ship unattended
//   low        — only unprotected files changed
//   empty      — nothing changed
// Fail-safe: a missing or unreadable rules file classifies as `protected`, so an
// unconfigured repo can never produce a "low" verdict.

/** Glob → RegExp. Supports **, *, ?; matches the whole repo-relative path. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // "**/" matches zero or more directories; a trailing "**" matches anything
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else if ('\\^$+.()|{}[]'.includes(c)) {
      re += '\\' + c
    } else {
      re += c
    }
  }
  return new RegExp('^' + re + '$')
}

const matches = (file, glob) => globToRegExp(glob).test(file)

/**
 * @param {string[]} changedFiles repo-relative paths
 * @param {{forbidden?: string[], protected?: {area: string, globs: string[]}[]} | null} rules
 */
export function classify(changedFiles, rules) {
  const files = [...new Set(changedFiles.map((f) => f.trim()).filter(Boolean))].sort()
  if (!rules) {
    return {
      risk: 'protected',
      reason: 'No .ophir/protected.json in this repo, so nothing can be treated as low risk.',
      changedFiles: files,
      forbiddenHits: [],
      protectedHits: [],
    }
  }
  const forbiddenHits = []
  const protectedHits = []
  for (const file of files) {
    const f = (rules.forbidden ?? []).find((g) => matches(file, g))
    if (f) forbiddenHits.push({ file, glob: f })
    for (const area of rules.protected ?? []) {
      const g = (area.globs ?? []).find((gl) => matches(file, gl))
      if (g) protectedHits.push({ file, area: area.area, glob: g })
    }
  }
  let risk = 'low'
  let reason = 'Only unprotected files changed.'
  if (files.length === 0) {
    risk = 'empty'
    reason = 'No files changed.'
  } else if (forbiddenHits.length) {
    risk = 'forbidden'
    reason = `A fix branch may not change: ${forbiddenHits.map((h) => h.file).join(', ')}.`
  } else if (protectedHits.length) {
    risk = 'protected'
    const areas = [...new Set(protectedHits.map((h) => h.area))]
    reason = `Touches a protected area (${areas.join(', ')}). Needs a human at the ship gate.`
  }
  return { risk, reason, changedFiles: files, forbiddenHits, protectedHits }
}

export const isTestFile = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)

// CLI: node classify.mjs <rules.json> <changed-files.txt> → JSON on stdout
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs')
  const [rulesPath, changedPath] = process.argv.slice(2)
  let rules = null
  try {
    rules = JSON.parse(readFileSync(rulesPath, 'utf8'))
  } catch {
    rules = null
  }
  const changed = readFileSync(changedPath, 'utf8').split('\n')
  const result = classify(changed, rules)
  result.testFiles = result.changedFiles.filter(isTestFile)
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}
