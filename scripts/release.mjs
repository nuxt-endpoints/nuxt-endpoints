// Prepares a release: works out the next version from the commits since the
// last tag, moves the CHANGELOG's `## Unreleased` section under it, bumps
// package.json, runs every check that can run locally, and commits.
//
// Deliberately stops before anything outward-facing. Creating the tag and the
// GitHub Release is what triggers the npm publish, and an npm version cannot be
// republished — so those two commands are printed for a human to run, never
// executed here. The E2E suite is also left out: it binds a port, which not
// every environment allows, and it has to pass before the release anyway.
import { execFile } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const changelogPath = join(root, 'CHANGELOG.md')
const packagePath = join(root, 'package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const requestedVersion = args.find((arg) => /^\d+\.\d+\.\d+$/.test(arg))

async function run(command, commandArgs, options = {}) {
  return execFileAsync(command, commandArgs, { cwd: root, maxBuffer: 32 * 1024 * 1024, ...options })
}

async function git(...gitArgs) {
  const { stdout } = await run('git', gitArgs)
  return stdout.trim()
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

// --- state checks -----------------------------------------------------------

if (await git('status', '--porcelain')) {
  fail('The working tree has uncommitted changes. Commit or stash them first.')
}

const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') {
  fail(`Releases are cut from main, not ${branch}.`)
}

// Everything being released has to be on the remote already, so the release
// commit is the only thing this adds.
// A stale `origin/main` would make this check meaningless in both directions,
// so a failed fetch skips it outright rather than comparing against whatever
// was last seen.
let remoteIsCurrent = true
try {
  await run('git', ['fetch', '--quiet', 'origin', 'main'])
} catch {
  remoteIsCurrent = false
  console.warn('! Could not reach origin; skipping the up-to-date check.')
}
if (remoteIsCurrent) {
  const [local, remote] = await Promise.all([
    git('rev-parse', 'HEAD'),
    git('rev-parse', 'origin/main').catch(() => ''),
  ])
  if (remote && local !== remote) {
    fail('HEAD and origin/main differ. Push (or pull) before cutting a release.')
  }
}

// --- next version -----------------------------------------------------------

const currentVersion = JSON.parse(await readFile(packagePath, 'utf8')).version
const lastTag = await git('describe', '--tags', '--abbrev=0').catch(() => '')
const range = lastTag ? `${lastTag}..HEAD` : 'HEAD'
const subjects = (await git('log', range, '--format=%s')).split('\n').filter(Boolean)
const bodies = await git('log', range, '--format=%B')

const hasBreaking =
  /^BREAKING CHANGE:/m.test(bodies) || subjects.some((s) => /^\w+(\(.+\))?!:/.test(s))
const hasFeature = subjects.some((s) => /^feat(\(.+\))?!?:/.test(s))

// Under 0.x a breaking change is a minor, which is what every release here has
// done so far. Above 1.0 it would be a major, hence the branch.
const [major, minor, patch] = currentVersion.split('.').map(Number)
const derived =
  major === 0
    ? hasBreaking || hasFeature
      ? `0.${minor + 1}.0`
      : `0.${minor}.${patch + 1}`
    : hasBreaking
      ? `${major + 1}.0.0`
      : hasFeature
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`

const version = requestedVersion ?? derived
const reason = hasBreaking ? 'breaking change' : hasFeature ? 'feature' : 'fixes only'

console.log(`Current      ${currentVersion}`)
console.log(`Commits      ${subjects.length} since ${lastTag || 'the beginning'} (${reason})`)
console.log(`Next         ${version}${requestedVersion ? ' (given)' : ' (derived)'}`)

if (await git('tag', '--list', `v${version}`)) {
  fail(`Tag v${version} already exists.`)
}

// --- changelog --------------------------------------------------------------

const changelog = await readFile(changelogPath, 'utf8')
if (!changelog.includes('## Unreleased\n')) {
  fail('CHANGELOG.md has no `## Unreleased` section — nothing to release.')
}

const unreleased = changelog.slice(
  changelog.indexOf('## Unreleased\n') + '## Unreleased\n'.length,
  changelog.indexOf('\n## ', changelog.indexOf('## Unreleased\n') + 1),
)
if (unreleased.trim() === '') {
  fail('The `## Unreleased` section is empty — write the entries first.')
}

const today = new Date().toISOString().slice(0, 10)
console.log(`Date         ${today}`)
console.log(`Notes        ${unreleased.trim().split('\n').length} lines under Unreleased`)

if (dryRun) {
  console.log('\n(dry run — nothing written)')
  process.exit(0)
}

await writeFile(changelogPath, changelog.replace('## Unreleased\n', `## ${version} - ${today}\n`))
await writeFile(
  packagePath,
  (await readFile(packagePath, 'utf8')).replace(
    `"version": "${currentVersion}"`,
    `"version": "${version}"`,
  ),
)
console.log('\n✓ CHANGELOG.md and package.json updated')

// --- checks -----------------------------------------------------------------

const checks = [
  ['fmt', 'vp', ['run', 'fmt']],
  ['lint', 'vp', ['run', 'lint']],
  ['typecheck', 'vp', ['run', 'test:typecheck']],
  ['fixture types', process.execPath, ['scripts/typecheck-fixture.mjs']],
  ['tests', 'vp', ['run', 'test']],
  ['build', 'vp', ['run', 'build']],
]

for (const [label, command, commandArgs] of checks) {
  process.stdout.write(`  ${label} … `)
  try {
    await run(command, commandArgs)
    console.log('ok')
  } catch (error) {
    console.log('failed')
    console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`)
    fail(`${label} failed. The bump is still in the working tree; fix and re-run.`)
  }
}

// The packed tarball is what users actually install, so it is built and run
// rather than trusted.
process.stdout.write('  packed package … ')
const tarball = join(root, `nuxt-endpoints-${version}.tgz`)
try {
  await run('npm', ['pack', '--silent', '--pack-destination', root])
  await run(process.execPath, ['scripts/smoke-packed-package.mjs', tarball])
  console.log('ok')
} catch (error) {
  console.log('failed')
  console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`)
  await rm(tarball, { force: true })
  fail('The packed package did not build in a fresh app.')
}
await rm(tarball, { force: true })

// --- commit -----------------------------------------------------------------

await run('git', ['add', 'CHANGELOG.md', 'package.json'])
await run('git', ['commit', '-m', `chore: prepare v${version} release`])
console.log(`\n✓ committed chore: prepare v${version} release`)

console.log(`
Remaining steps, for you to run — each one is outward-facing:

  git push origin main
  git tag v${version} && git push origin v${version}
  gh release create v${version} --title v${version} \\
    --notes-file <(sed -n '/^## ${version}/,/^## /p' CHANGELOG.md | sed '$d')

Publishing to npm is triggered by the GitHub Release, and a published version
cannot be replaced — so run the E2E suite (\`vp run test:e2e\`) before the tag if
it has not passed on this commit already.
`)
