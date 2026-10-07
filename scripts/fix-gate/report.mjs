// Sends the fix-gate verdict to the pipeline owner as a SIGNED report.
//
// Signature: hex HMAC-SHA256 of `${timestamp}.${body}` with OPHIR_PIPELINE_SECRET,
// sent as X-Ophir-Timestamp / X-Ophir-Signature. The receiver rejects a bad
// signature or a timestamp more than 5 minutes old (no forgery, no replay).
// No secret configured → the report is skipped with a notice, never an error,
// so the gate still runs (and shows its verdict) before the secret exists.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

export function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

/** The branch is `fix/<bug-id>`; anything else is not a pipeline branch. */
export function bugIdFromBranch(branch) {
  const m = /^fix\/([A-Za-z0-9_-]+)$/.exec(branch ?? '')
  return m ? m[1] : null
}

export function buildReport(gate, env) {
  return {
    bugId: bugIdFromBranch(env.GITHUB_REF_NAME),
    repo: env.GITHUB_REPOSITORY,
    branch: env.GITHUB_REF_NAME,
    sha: env.GITHUB_SHA,
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    ci: env.CI_OUTCOME, // success | failure | skipped | cancelled
    risk: gate.risk,
    reason: gate.reason,
    changedFiles: gate.changedFiles,
    testFiles: gate.testFiles ?? [],
    protectedHits: gate.protectedHits,
    forbiddenHits: gate.forbiddenHits,
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env
  const secret = env.OPHIR_PIPELINE_SECRET
  const url = env.OPHIR_REPORT_URL
  if (!secret) {
    console.log('::notice::OPHIR_PIPELINE_SECRET not set: verdict not reported (the gate still ran).')
    process.exit(0)
  }
  const gate = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const report = buildReport(gate, env)
  if (!report.bugId) {
    console.log(`::notice::Branch "${env.GITHUB_REF_NAME}" is not fix/<bug-id>: nothing to report.`)
    process.exit(0)
  }
  const body = JSON.stringify(report)
  const ts = String(Date.now())
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ophir-timestamp': ts,
        'x-ophir-signature': sign(secret, ts, body),
      },
      body,
      signal: AbortSignal.timeout(20_000),
    })
    const text = await res.text()
    if (!res.ok) {
      console.log(`::warning::Report rejected (${res.status}): ${text.slice(0, 300)}`)
    } else {
      console.log(`Reported to Ophir: ${text.slice(0, 300)}`)
    }
  } catch (e) {
    console.log(`::warning::Could not reach Ophir: ${e.message}`)
  }
}
