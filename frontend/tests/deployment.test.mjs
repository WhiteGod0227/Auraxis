import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  deploymentOrigin,
  verifyPublicArtifact,
} from '../scripts/deployment-policy.mjs'

test('deployment requires explicit HTTPS hosting or an explicit same-origin proxy', () => {
  for (const value of [
    undefined,
    '',
    'http://api.auraxis.com',
    'https://localhost',
    'https://127.0.0.1',
    'https://backend.invalid',
    'https://example.com',
    'https://u:p@api.auraxis.com',
    'https://api.auraxis.com/path',
    'https://api.auraxis.com/?key=x',
  ]) {
    assert.throws(() => deploymentOrigin(value))
  }
  assert.equal(deploymentOrigin('same-origin'), 'same-origin')
  assert.equal(
    deploymentOrigin('https://api.auraxis.com/'),
    'https://api.auraxis.com',
  )
})

test('release rejects nested market exports, databases and credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'auraxis-release-'))
  try {
    await mkdir(join(root, 'assets'))
    await writeFile(join(root, 'index.html'), '<main>Research</main>')
    await writeFile(join(root, 'assets', 'app.js'), 'console.log("app")')
    assert.equal(await verifyPublicArtifact(root), 2)
    for (const filename of [
      'market.csv',
      'market.db',
      'auth.sqlite3',
      'auth.sqlite3-wal',
      '.env',
      '.env.production',
    ]) {
      const target = join(root, 'assets', filename)
      await writeFile(target, 'private')
      await assert.rejects(verifyPublicArtifact(root), /Private or market-data/)
      await rm(target)
    }
    await mkdir(join(root, 'snapshots'))
    await assert.rejects(verifyPublicArtifact(root), /Private or market-data/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
