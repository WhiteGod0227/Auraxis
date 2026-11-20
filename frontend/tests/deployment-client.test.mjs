import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

test('deployed analytics use the same-origin API without a literal URL prefix', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'auraxis-deployment-client-'))
  try {
    for (const name of ['api', 'schemas']) {
      const source = await readFile(
        new URL(`../src/lib/${name}.ts`, import.meta.url),
        'utf8',
      )
      const compiled = ts
        .transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
          },
        })
        .outputText.replaceAll(
          'import.meta.env',
          '({VITE_API_BASE_URL:"same-origin",BASE_URL:"/"})',
        )
        .replace(/from '\.\/(\w+)'/g, "from './$1.mjs'")
      await writeFile(join(folder, `${name}.mjs`), compiled)
    }
    const { createApiClient } = await import(
      pathToFileURL(join(folder, 'api.mjs')).href
    )
    for (const [override, expected] of [
      [undefined, '/api/meta'],
      ['same-origin', '/api/meta'],
      ['', '/api/meta'],
      ['https://api.auraxis.com/', 'https://api.auraxis.com/api/meta'],
    ]) {
      const calls = []
      const client = createApiClient({
        baseUrl: override,
        fetcher: async (url) => {
          calls.push(url)
          return new Response(JSON.stringify({ available: false }), {
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })
      const result = await client.request('/api/meta', {}, (value) => value)
      assert.deepEqual(calls, [expected])
      assert.equal(result.source, 'API')
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
