import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const urls = {}
for (const name of [
  'env',
  'sessionStore',
  'profile',
  'auth',
  'schemas',
  'api',
  'relativeValue',
  'alerts',
  'accountAlerts',
  'security',
]) {
  const code = ts
    .transpileModule(
      await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8'),
      {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      },
    )
    .outputText.replace(
      /from '\.\/(\w+)'/g,
      (_, dependency) => `from '${urls[dependency]}'`,
    )
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const { session } = await import(urls.auth)
const { createAccountAlertsClient, mergeAlertRules, parseAccountAlerts } =
  await import(urls.accountAlerts)
const { securityRequest } = await import(urls.security)
const user = { id: 1, name: 'One', email: 'one@example.test' }
const rule = {
  id: 'rule-1',
  pair: 'GOLDTEN-GOLDPETAL',
  metric: 'abs_z',
  threshold: 1.5,
  expiry: null,
}
const payload = {
  revision: 1,
  rules: [rule],
  updated_at: '2026-10-28T00:00:00Z',
}

test('account alert calls are private, preserve revisions and merge without duplicates', async () => {
  session.set(user)
  let request
  const client = createAccountAlertsClient(
    'http://local',
    async (url, options) => {
      request = { url, ...options }
      return new Response(JSON.stringify(payload))
    },
  )
  assert.deepEqual(await client.get(), payload)
  assert.equal(request.credentials, 'include')
  assert.equal(request.cache, 'no-store')
  await client.replace(1, [rule])
  assert.equal(request.method, 'PUT')
  assert.equal(JSON.parse(request.body).revision, 1)
  assert.equal(mergeAlertRules([rule], [{ ...rule, id: 'other' }]).length, 1)
  assert.throws(() =>
    mergeAlertRules(
      [],
      Array.from({ length: 21 }, (_, i) => ({
        ...rule,
        id: `rule-${i}`,
        threshold: i + 1,
      })),
    ),
  )
  assert.throws(() => parseAccountAlerts({ ...payload, rules: [rule, rule] }))
  session.set(null)
})
test('account switches invalidate even a response body that finishes late', async () => {
  session.set(user)
  let finish
  const body = new Promise((resolve) => {
    finish = resolve
  })
  const client = createAccountAlertsClient('', async () => ({
    ok: true,
    status: 200,
    json: () => body,
  }))
  const pending = client.get()
  await new Promise((resolve) => setTimeout(resolve, 0))
  session.set({ ...user, id: 2 })
  finish(payload)
  await assert.rejects(pending, /Account changed/)
  session.set(null)
})
test('security requests never fall back offline, use no-store and hide malformed secret payloads', async () => {
  const previous = globalThis.fetch
  session.set(user)
  try {
    let request
    globalThis.fetch = async (url, options) => {
      request = { url, ...options }
      return new Response(
        JSON.stringify({
          mfa_enabled: false,
          recovery_codes_remaining: 0,
          email_verified: false,
          email_delivery_configured: false,
        }),
      )
    }
    await securityRequest()
    assert.equal(request.cache, 'no-store')
    assert.equal(request.credentials, 'include')
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ secret: 'invalid' }))
    await assert.rejects(
      securityRequest('/mfa/setup', { password: 'private' }),
      /Invalid authenticator/,
    )
    globalThis.fetch = async () => {
      throw Error('offline')
    }
    await assert.rejects(securityRequest(), /require the backend/)
  } finally {
    globalThis.fetch = previous
    session.set(null)
  }
})
