// Deployment packaging only. Does not modify the local preview's dist folder.
import { readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const localCheck = process.argv.includes('--local-check')
const raw = localCheck
  ? 'https://backend-not-configured.invalid'
  : process.env.VITE_API_BASE_URL
let api
try {
  api = new URL(raw)
} catch {
  throw new Error(
    'Set VITE_API_BASE_URL to the actual public HTTPS backend origin.',
  )
}
if (
  !localCheck &&
  (api.protocol !== 'https:' ||
    api.username ||
    api.password ||
    api.search ||
    api.hash ||
    api.pathname !== '/' ||
    ['localhost', '127.0.0.1', '[::1]'].includes(api.hostname) ||
    api.hostname.endsWith('.invalid') ||
    api.hostname.endsWith('.example') ||
    api.hostname.endsWith('.test'))
) {
  throw new Error(
    'Deployment requires a public HTTPS API origin without credentials, path or query.',
  )
}

async function verifySnapshots(root) {
  const manifest = JSON.parse(
    await readFile(join(root, 'manifest.json'), 'utf8'),
  )
  for (const entry of manifest.files) {
    if (!/^versions\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.json$/.test(entry.path)) {
      throw new Error('Unsafe snapshot path')
    }
    const bytes = await readFile(join(root, entry.path))
    JSON.parse(bytes.toString('utf8'))
    if (
      bytes.length !== entry.size_bytes ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    ) {
      throw new Error('Snapshot integrity check failed')
    }
  }
  return manifest.files.length
}
await verifySnapshots(join(frontend, 'public/snapshots'))
for (const args of [
  [join(frontend, 'node_modules/typescript/bin/tsc'), '-b'],
  [
    join(frontend, 'node_modules/vite/bin/vite.js'),
    'build',
    '--outDir',
    'dist-deploy',
    '--emptyOutDir',
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: frontend,
    env: { ...process.env, VITE_API_BASE_URL: api.origin },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const output = resolve(frontend, 'dist-deploy')
for (const name of ['index.html', '404.html', '_redirects', '_headers']) {
  if (!(await stat(join(output, name))).isFile())
    throw new Error('Incomplete deployment output')
}
if (localCheck) {
  await writeFile(
    join(output, 'DEPLOYMENT_NOT_CONFIGURED.txt'),
    'LOCAL BUILD CHECK ONLY. API is not configured. Do not publish this build. Rebuild with the assigned HTTPS backend origin.\n',
  )
}
console.log(
  `${localCheck ? 'Local check only; DO NOT PUBLISH' : 'Deployment package ready'}; ${await verifySnapshots(join(output, 'snapshots'))} snapshots verified. Not deployed.`,
)
