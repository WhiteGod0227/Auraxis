import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export function deploymentOrigin(raw) {
  if (raw === 'same-origin') return raw
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(
      'Set VITE_API_BASE_URL to an assigned HTTPS API origin or same-origin.',
    )
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    [
      'localhost',
      '127.0.0.1',
      '[::1]',
      'example.com',
      'example.org',
      'example.net',
    ].includes(url.hostname) ||
    /\.(invalid|example|test|localhost)$/.test(url.hostname)
  ) {
    throw new Error(
      'Use an assigned public HTTPS API origin without credentials, path or query, or same-origin with a configured proxy.',
    )
  }
  return url.origin
}

export async function verifyPublicArtifact(root) {
  let files = 0
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Release may not contain symlinks.')
      if (
        /^(snapshots|raw_csv|data_cache|node_modules|\.git)$/i.test(
          entry.name,
        ) ||
        /\.(csv|db|sqlite3?|db-.+|sqlite3?-.+)$/i.test(entry.name) ||
        /^\.env(?:\.|$)/i.test(entry.name)
      ) {
        throw new Error(
          `Private or market-data content in release: ${entry.name}`,
        )
      }
      if (entry.isDirectory()) await walk(join(directory, entry.name))
      else files++
    }
  }
  await walk(root)
  return files
}
