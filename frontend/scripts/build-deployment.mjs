// Data-free release package. Local dist and public snapshots are preserved.
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { deploymentOrigin, verifyPublicArtifact } from './deployment-policy.mjs'

const frontend = fileURLToPath(new URL('../', import.meta.url))
const localCheck = process.argv.includes('--local-check')
const origin = deploymentOrigin(
  localCheck ? 'same-origin' : process.env.VITE_API_BASE_URL,
)
for (const args of [
  [join(frontend, 'node_modules/typescript/bin/tsc'), '-b'],
  [
    join(frontend, 'node_modules/vite/bin/vite.js'),
    'build',
    '--mode',
    'deployment',
    '--outDir',
    'dist-deploy',
    '--emptyOutDir',
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    cwd: frontend,
    env: { ...process.env, VITE_API_BASE_URL: origin },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const output = join(frontend, 'dist-deploy')
for (const name of ['404.html', '_redirects', '_headers']) {
  await copyFile(join(frontend, 'public', name), join(output, name))
}
await writeFile(
  join(output, 'release.json'),
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      api_origin: origin,
      market_data_included: false,
      deployment_configured: !localCheck,
    },
    null,
    2,
  ),
)
if (localCheck)
  await writeFile(
    join(output, 'DEPLOYMENT_NOT_CONFIGURED.txt'),
    'LOCAL PACKAGE CHECK ONLY. Hosting and TLS are not configured. Do not publish this artifact. Rebuild with the assigned HTTPS API origin or same-origin after proxy setup.\n',
  )
await readFile(join(output, 'index.html'))
const count = await verifyPublicArtifact(output)
console.log(
  `${localCheck ? 'LOCAL CHECK; DO NOT PUBLISH' : 'Data-free package ready'}: ${count} files. No CSVs, databases or snapshots. Not deployed.`,
)
