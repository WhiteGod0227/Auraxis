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
  'workspaces',
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
    .outputText.replace(/from '\.\/(\w+)'/g, (_, dep) => `from '${urls[dep]}'`)
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const { auth, session, refreshSession } = await import(urls.auth)
const {
  validateName,
  parseProfile,
  creationDate,
  nameEditor,
  initialNameEdit,
} = await import(urls.profile)
const { safeReturn, createExclusiveAction } = await import(urls.workspaces)
const user = { id: 1, name: 'Original', email: 'profile@example.test' }
const profile = { ...user, created_at: null }

test('Unicode names, trimming, code-point length and controls follow backend limits', () => {
  for (const value of [
    '  आयुष सिंह  ',
    'Élodie',
    '张伟',
    'O’Connor',
    'علي',
    'x'.repeat(100),
  ])
    assert.equal(validateName(value), undefined)
  for (const value of [
    '',
    '   ',
    'x'.repeat(101),
    'x\n',
    '\tx',
    'a\u0000b',
    'a\u202eb',
  ])
    assert.ok(validateName(value))
  assert.equal(creationDate(null), 'Unavailable')
  assert.throws(() => parseProfile(user), /timestamp/)
  assert.throws(
    () => parseProfile({ ...user, created_at: '2026-10-22' }),
    /timestamp/,
  )
  assert.match(creationDate('2026-10-22T10:00:00Z'), /UTC/)
  assert.equal(safeReturn('/app/profile'), '/app/profile')
  for (const value of [
    '//evil.test/app/profile',
    'https://evil.test',
    '/app/profile?token=secret',
  ])
    assert.equal(safeReturn(value), '/')
})

test('confirmed name update publishes shared state and refresh persists it; requests are private and name-only', async () => {
  const original = globalThis.fetch
  session.set(user)
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ user: { ...profile, name: 'आयुष' } }))
  }
  try {
    await auth.updateName('आयुष')
    assert.equal(session.getSnapshot().user.name, 'आयुष')
    assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'आयुष' })
    assert.equal(calls[0].options.method, 'PATCH')
    assert.equal(calls[0].options.credentials, 'include')
    assert.equal(calls[0].options.cache, 'no-store')
    assert.match(calls[0].url, /\/api\/auth\/profile$/)
    await auth.me()
    assert.equal(session.getSnapshot().user.name, 'आयुष')
    assert.equal((await auth.profile()).created_at, null)
  } finally {
    globalThis.fetch = original
  }
})

test('failed edit does not change shared name; no success before confirmation and duplicate saves are excluded', async () => {
  const original = globalThis.fetch
  session.set(user)
  let finish
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return new Promise((done) => {
      finish = done
    })
  }
  const action = createExclusiveAction()
  try {
    const pending = action.run(() => auth.updateName('Changed'))
    await action.run(() => auth.updateName('Duplicate'))
    assert.equal(calls, 1)
    assert.equal(session.getSnapshot().user.name, 'Original')
    finish(
      new Response(JSON.stringify({ detail: 'Update unavailable.' }), {
        status: 500,
      }),
    )
    await assert.rejects(pending, /Update unavailable/)
    assert.equal(session.getSnapshot().user.name, 'Original')
    assert.equal(action.busy, false)
  } finally {
    globalThis.fetch = original
  }
})

test('late profile success/errors cannot restore or clear another account', async () => {
  const original = globalThis.fetch
  for (const success of [true, false]) {
    session.set(user)
    let finish
    globalThis.fetch = async () =>
      new Promise((done) => {
        finish = done
      })
    const pending = auth.profile()
    session.set({ ...user, id: 2, name: 'Other' })
    finish(
      new Response(
        JSON.stringify(success ? { user: profile } : { detail: 'Expired' }),
        { status: success ? 200 : 401 },
      ),
    )
    await assert.rejects(pending, /Account changed/)
    assert.equal(session.getSnapshot().user.id, 2)
  }
  globalThis.fetch = original
})

test('older session responses cannot overwrite a confirmed name update', async () => {
  const original = globalThis.fetch
  session.set(user)
  let finish
  globalThis.fetch = async (_url, options) =>
    options.method === 'GET'
      ? new Promise((done) => {
          finish = done
        })
      : new Response(JSON.stringify({ user: { ...profile, name: 'New' } }))
  try {
    const old = refreshSession(true)
    await auth.updateName('New')
    finish(new Response(JSON.stringify({ user })))
    await assert.rejects(old, /Profile changed/)
    assert.equal(session.getSnapshot().user.name, 'New')
  } finally {
    globalThis.fetch = original
  }
})

test('profile outage clears private state with retry message; expiry clears account', async () => {
  const original = globalThis.fetch
  try {
    session.set(user)
    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    await assert.rejects(auth.profile(), /unavailable/)
    assert.equal(session.getSnapshot().user, null)
    assert.match(session.getSnapshot().error, /backend/)
    session.set(user)
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: 'Session expired.' }), {
        status: 401,
      })
    await assert.rejects(auth.profile(), /expired/)
    assert.equal(session.getSnapshot().user, null)
  } finally {
    globalThis.fetch = original
  }
})

test('cancel discards unsaved edits; failed or pending edits never become confirmed names', () => {
  const original = initialNameEdit('Original')
  const edit = nameEditor(
    nameEditor(original, { type: 'begin', value: 'Original' }),
    { type: 'change', value: 'Draft' },
  )
  assert.deepEqual(
    nameEditor(edit, { type: 'cancel', value: 'Original' }),
    original,
  )
  const pending = nameEditor(edit, { type: 'pending' })
  assert.equal(pending.success, '')
  assert.deepEqual(
    nameEditor(pending, { type: 'cancel', value: 'Original' }),
    pending,
  )
  const failed = nameEditor(
    nameEditor(pending, { type: 'error', value: 'Server unavailable' }),
    { type: 'finished' },
  )
  assert.equal(failed.editing, true)
  assert.equal(failed.draft, 'Draft')
  assert.equal(failed.success, '')
  const saved = nameEditor(pending, { type: 'saved' })
  assert.equal(saved.editing, false)
  assert.equal(saved.success, 'Name updated.')
})

test('profile UI wires Cancel, linked validation, guarded pending saves and no private persistence', async () => {
  const source = await readFile(
    new URL('../src/pages/ProfilePage.tsx', import.meta.url),
    'utf8',
  )
  assert.match(source, /type: 'cancel', value: name/)
  assert.match(
    source,
    /aria-describedby="profile-name-error profile-edit-help"/,
  )
  assert.match(source, /action\.current\.busy/)
  assert.match(source, /await auth\.updateName/)
  assert.match(source, /key=\{account\.epoch\}/)
  assert.doesNotMatch(
    source,
    /localStorage|sessionStorage|dangerouslySetInnerHTML|Verified email/,
  )
})
