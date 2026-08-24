// Cuts a release end to end: works out the next version from the commits since
// the last tag, moves the CHANGELOG's `## Unreleased` section under it, bumps
// package.json, runs every check that can run locally, commits, then pushes,
// tags, and creates the GitHub Release.
//
// The GitHub Release is what triggers the npm publish, and a published version
// cannot be replaced. That one step is therefore confirmed out loud — you type
// the version to proceed — rather than skipped: everything before it has already
// been verified by then, so handing back a list of commands to paste would only
// move the risk, not reduce it.
//
// Flags:
//   --dry-run       report the derived version and stop before writing anything
//   X.Y.Z           use this version instead of deriving one
//   --publish-only  skip preparation; push, tag, and release the current version
//   --no-publish    prepare and commit, but stop before pushing
//   --yes           do not prompt before the irreversible step
//
// The E2E suite is left out on purpose: it binds a port, which not every
// environment allows, and it has to have passed before a release anyway.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const changelogPath = join(root, 'CHANGELOG.md')
const packagePath = join(root, 'package.json')

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const publishOnly = args.includes('--publish-only')
const noPublish = args.includes('--no-publish')
const assumeYes = args.includes('--yes')
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

// Slices one release's entry out of the CHANGELOG. Used both to check that
// there is something to release and to write the GitHub Release notes, so the
// notes can never disagree with the file.
function changelogSection(changelog, heading) {
  const start = changelog.indexOf(heading)
  if (start === -1) return undefined
  const after = changelog.indexOf('\n## ', start + 1)
  return changelog.slice(start + heading.length, after === -1 ? undefined : after)
}

// --- state checks -----------------------------------------------------------

if (await git('status', '--porcelain')) {
  fail('The working tree has uncommitted changes. Commit or stash them first.')
}

const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') {
  fail(`Releases are cut from main, not ${branch}.`)
}

// This script pushes, so HEAD being ahead of origin/main is the normal state.
// What must not happen is releasing while someone else's commits are only on
// the remote — the push would be rejected after the whole suite had run.
let remote = ''
try {
  await run('git', ['fetch', '--quiet', 'origin', 'main'])
  remote = await git('rev-parse', 'origin/main')
} catch {
  console.warn('! Could not reach origin; skipping the up-to-date check.')
}
if (remote) {
  const behind = await run('git', ['merge-base', '--is-ancestor', remote, 'HEAD']).then(
    () => false,
    () => true,
  )
  if (behind) {
    fail('origin/main has commits this branch does not. Pull before cutting a release.')
  }
}

const willPublish = !dryRun && !noPublish

// Checked up front: the alternative is discovering a missing or unauthenticated
// `gh` after the whole suite has run and the release commit already exists.
if (willPublish) {
  await run('gh', ['auth', 'status']).catch(() => {
    fail('`gh` is missing or not authenticated. Run `gh auth login`, or pass --no-publish.')
  })
  if (!assumeYes && !process.stdin.isTTY) {
    fail('The release step needs a terminal to confirm on. Pass --yes to skip the prompt.')
  }
}

const currentVersion = JSON.parse(await readFile(packagePath, 'utf8')).version

// --- next version -----------------------------------------------------------

let version = currentVersion

if (publishOnly) {
  console.log(`Publishing    ${version} (from package.json, no preparation)`)
} else {
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

  version = requestedVersion ?? derived
  const reason = hasBreaking ? 'breaking change' : hasFeature ? 'feature' : 'fixes only'

  console.log(`Current       ${currentVersion}`)
  console.log(`Commits       ${subjects.length} since ${lastTag || 'the beginning'} (${reason})`)
  console.log(`Next          ${version}${requestedVersion ? ' (given)' : ' (derived)'}`)
}

const tag = `v${version}`
if (await git('tag', '--list', tag)) {
  fail(`Tag ${tag} already exists.`)
}

// --- changelog and bump -----------------------------------------------------

const today = new Date().toISOString().slice(0, 10)
let releaseHeading = `## ${version} - ${today}`

// A prepared release may be finished on a later day than it was prepared, so
// the heading is found by version rather than assumed to carry today's date.
if (publishOnly) {
  const dated = (await readFile(changelogPath, 'utf8')).match(
    new RegExp(`^## ${version.replace(/\./g, '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'm'),
  )
  if (!dated) {
    fail(`CHANGELOG.md has no \`## ${version} - <date>\` heading to release.`)
  }
  releaseHeading = dated[0]
}

if (!publishOnly) {
  const changelog = await readFile(changelogPath, 'utf8')
  const unreleased = changelogSection(changelog, '## Unreleased\n')

  if (unreleased === undefined) {
    fail('CHANGELOG.md has no `## Unreleased` section — nothing to release.')
  }
  if (unreleased.trim() === '') {
    fail('The `## Unreleased` section is empty — write the entries first.')
  }

  console.log(`Date          ${today}`)
  console.log(`Notes         ${unreleased.trim().split('\n').length} lines under Unreleased`)

  if (dryRun) {
    console.log('\n(dry run — nothing written)')
    process.exit(0)
  }

  await writeFile(changelogPath, changelog.replace('## Unreleased', releaseHeading))
  await writeFile(
    packagePath,
    (await readFile(packagePath, 'utf8')).replace(
      `"version": "${currentVersion}"`,
      `"version": "${version}"`,
    ),
  )
  console.log('\n✓ CHANGELOG.md and package.json updated')

  // --- checks ---------------------------------------------------------------

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

  // --- commit ---------------------------------------------------------------

  await run('git', ['add', 'CHANGELOG.md', 'package.json'])
  await run('git', ['commit', '-m', `chore: prepare ${tag} release`])
  console.log(`\n✓ committed chore: prepare ${tag} release`)
}

if (noPublish) {
  console.log(`\nStopped before publishing. To finish: node scripts/release.mjs --publish-only\n`)
  process.exit(0)
}

// --- publish ----------------------------------------------------------------

const notes = changelogSection(await readFile(changelogPath, 'utf8'), `${releaseHeading}\n`)
if (notes === undefined || notes.trim() === '') {
  fail(`CHANGELOG.md has no \`${releaseHeading}\` section to use as release notes.`)
}

console.log(`
About to publish ${tag}:

  git push origin main
  git tag ${tag} && git push origin ${tag}
  gh release create ${tag}

The GitHub Release triggers the npm publish, and a published version cannot be
replaced or re-uploaded. Release notes (${notes.trim().split('\n').length} lines):
${notes.trim().replace(/^/gm, '  │ ')}
`)

if (!assumeYes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Type ${version} to publish, anything else to stop: `)
  rl.close()
  if (answer.trim() !== version) {
    console.log(
      `\nStopped. The release commit is in place; re-run with --publish-only to finish.\n`,
    )
    process.exit(0)
  }
}

process.stdout.write('\n  push main … ')
await run('git', ['push', 'origin', 'main'])
console.log('ok')

process.stdout.write(`  tag ${tag} … `)
await run('git', ['tag', tag])
await run('git', ['push', 'origin', tag])
console.log('ok')

process.stdout.write('  github release … ')
const notesDir = await mkdtemp(join(tmpdir(), 'nuxt-endpoints-release-'))
const notesPath = join(notesDir, 'notes.md')
try {
  await writeFile(notesPath, `${notes.trim()}\n`)
  const { stdout } = await run('gh', [
    'release',
    'create',
    tag,
    '--title',
    tag,
    '--notes-file',
    notesPath,
  ])
  console.log('ok')
  console.log(`\n✓ released ${tag}\n  ${stdout.trim()}`)
  console.log('\nnpm publish runs from the release workflow; watch it with `gh run watch`.\n')
} catch (error) {
  console.log('failed')
  console.error(`${error.stdout ?? ''}${error.stderr ?? ''}`)
  fail(
    `The tag is pushed but the release was not created. Retry with:\n` +
      `  gh release create ${tag} --title ${tag} --notes-file <notes>`,
  )
} finally {
  await rm(notesDir, { recursive: true, force: true })
}
