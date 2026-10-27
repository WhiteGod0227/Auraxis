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
  'relativeValue',
  'termStructure',
  'backtest',
]) {
  const source = await readFile(
    new URL(`../src/lib/${name}.ts`, import.meta.url),
    'utf8',
  )
  const code = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    })
    .outputText.replace(/from '\.\/(\w+)'/g, (_, dep) => `from '${urls[dep]}'`)
  urls[name] =
    'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
}
const w = await import(urls.workspaces)
const { session } = await import(urls.auth)
const { createSessionStore } = await import(urls.sessionStore)
const { defaultDraft } = await import(urls.backtest)
const { canonicalParameters } = await import(urls.api)
const account = { id: 1, name: 'One', email: 'one@example.test' }
const configuration = {
  kind: 'relative_value',
  query: canonicalParameters('/api/spreads', {
    pair: 'GOLDM-GOLDTEN',
    carry_adjusted: false,
    purity: false,
    min_volume_grams: 0,
  }),
  expiry: { mode: 'explicit', value: '2026-11-05' },
}
const workspace = {
  id: '00112233-4455-4677-8899-aabbccddeeff',
  owner_id: 1,
  title: '<script>plain title</script>',
  notes: '<b>plain notes</b>',
  configuration_version: 1,
  configuration,
  saved_context: { data_as_of: '2026-10-01', source: 'Offline snapshot' },
  revision: 1,
  created_at: '2026-10-22T00:00:00Z',
  updated_at: '2026-10-22T00:00:00Z',
}

test('all three configuration types preserve exact request settings, false, zero, null and integer sizing', () => {
  const relative = w.parseWorkspace(workspace)
  assert.equal(relative.configuration.query.purity, false)
  assert.equal(relative.configuration.query.carry_adjusted, false)
  assert.equal(relative.configuration.query.min_volume_grams, 0)
  assert.equal(relative.configuration.query.start, null)
  const term = w.parseWorkspace({
    ...workspace,
    configuration: {
      kind: 'term_structure',
      curve: canonicalParameters('/api/curve', {
        product: 'GOLDTEN',
        date: '2026-09-14',
      }),
      roll: canonicalParameters('/api/rolldown', { product: 'GOLDTEN' }),
      curve_expiry: w.selection('2026-10-30'),
      roll_expiry: w.selection(),
    },
  })
  assert.equal(term.configuration.curve.date, '2026-09-14')
  assert.deepEqual(term.configuration.roll_expiry, {
    mode: 'latest',
    value: null,
  })
  const backtest = w.parseWorkspace({
    ...workspace,
    configuration: {
      kind: 'backtest',
      query: canonicalParameters('/api/backtest', {
        pair: 'GOLDTEN-GOLDPETAL',
        sizing_mode: 'integer_lots',
        cost_bps_per_leg_per_side: 0,
        z_exit: 0,
      }),
      expiry: w.selection(),
    },
  })
  assert.equal(backtest.configuration.query.sizing_mode, 'integer_lots')
  assert.equal(backtest.configuration.query.cost_bps_per_leg_per_side, 0)
  assert.equal(backtest.configuration.query.z_exit, 0)
})

test('unsupported/incomplete legacy configurations fail instead of becoming defaults', () => {
  assert.throws(
    () => w.parseWorkspace({ ...workspace, configuration_version: 2 }),
    /version/,
  )
  assert.throws(
    () =>
      w.parseWorkspace({
        ...workspace,
        configuration: { ...configuration, query: { pair: 'GOLDM-GOLDTEN' } },
      }),
    /Incomplete/,
  )
  assert.throws(
    () =>
      w.parseWorkspace({
        ...workspace,
        configuration: {
          ...configuration,
          query: { ...configuration.query, window: 1 },
        },
      }),
    /window/,
  )
  assert.throws(
    () =>
      w.parseWorkspace({
        ...workspace,
        configuration: {
          ...configuration,
          expiry: { mode: 'latest', value: '2026-10-30' },
        },
      }),
    /selection/,
  )
})

test('unavailable explicit expiry never calls default selector; latest remains a mode', () => {
  const values = ['2026-11-30']
  let called = false
  assert.equal(
    w.restoredExpiry(values, w.selection('2026-10-30'), () => {
      called = true
      return values[0]
    }),
    undefined,
  )
  assert.equal(called, false)
  assert.equal(
    w.restoredExpiry(values, w.selection(), () => values[0]),
    '2026-11-30',
  )
  assert.match(
    w.workspaceRoute(workspace),
    /^\/app\/relative-value\?workspace=/,
  )
  assert.equal(
    w.safeReturn('/app/backtest?workspace=123'),
    '/app/backtest?workspace=123',
  )
  for (const unsafe of [
    'https://evil.test',
    '//evil.test/app/research',
    '/login',
    '/app/research?token=secret',
  ])
    assert.equal(w.safeReturn(unsafe), '/')
  assert.equal(w.safeReturn(null), '/')
})

test('save candidate comes from applied response, not unsubmitted Backtest controls; loading/stale/failed results cannot save', () => {
  const draft = {
    ...defaultDraft,
    sizing_mode: 'fractional',
    cost_bps_per_leg_per_side: 50,
  }
  const applied = {
    ...canonicalParameters('/api/backtest', {
      pair: 'GOLDTEN-GOLDPETAL',
      sizing_mode: 'integer_lots',
      cost_bps_per_leg_per_side: 0,
    }),
    use_purity_adjustment: false,
    requested_expiry: null,
  }
  const response = {
    source: 'API',
    data: { configuration: applied, data_as_of: '2026-10-01' },
  }
  const candidate = w.researchCandidate(
    response,
    false,
    w.backtestConfiguration(response.data, '2026-10-30'),
  )
  assert.equal(candidate.configuration.query.sizing_mode, 'integer_lots')
  assert.equal(candidate.configuration.query.cost_bps_per_leg_per_side, 0)
  assert.notEqual(
    candidate.configuration.query.cost_bps_per_leg_per_side,
    draft.cost_bps_per_leg_per_side,
  )
  assert.equal(
    w.researchCandidate(response, true, candidate.configuration),
    undefined,
  )
  assert.equal(
    w.researchCandidate(undefined, false, candidate.configuration),
    undefined,
  )
  assert.equal(w.researchCandidate(response, false, undefined), undefined)
})

test('request builders preserve every applied field and latest curve mode', () => {
  const spread = w.relativeConfiguration({
    configuration: { ...configuration.query, use_purity_adjustment: false },
  })
  assert.deepEqual(spread.query, configuration.query)
  const term = w.termConfiguration(
    {
      configuration: {
        product: 'GOLDTEN',
        date: null,
        use_purity_adjustment: false,
      },
    },
    {
      configuration: {
        product: 'GOLDTEN',
        expiry: null,
        start: null,
        end: null,
        use_purity_adjustment: false,
      },
    },
  )
  assert.equal(term.curve.date, null)
  assert.deepEqual(term.curve_expiry, w.selection())
})

test('exclusive submission rejects duplicate clicks and releases after failures', async () => {
  const action = w.createExclusiveAction()
  let resolve
  let calls = 0
  const first = action.run(() => {
    calls++
    return new Promise((done) => {
      resolve = done
    })
  })
  assert.equal(action.busy, true)
  await action.run(async () => {
    calls++
  })
  assert.equal(calls, 1)
  resolve('saved')
  assert.equal(await first, 'saved')
  await assert.rejects(
    action.run(async () => {
      throw new Error('failed save')
    }),
    /failed save/,
  )
  assert.equal(action.busy, false)
  assert.equal(
    await action.run(async () => 'retry succeeded'),
    'retry succeeded',
  )
})

test('private client uses credentialed no-store CRUD, no snapshot fallback, preserves errors and conflicts', async () => {
  session.set(account)
  const calls = []
  const client = w.createWorkspaceClient(
    'https://local.test',
    async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify(workspace), { status: 201 })
    },
  )
  assert.equal((await client.create(workspace)).id, workspace.id)
  assert.equal(calls[0].options.credentials, 'include')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.method, 'POST')
  const conflict = w.createWorkspaceClient(
    '',
    async () =>
      new Response(JSON.stringify({ detail: 'Reload before editing.' }), {
        status: 409,
      }),
  )
  await assert.rejects(
    conflict.update(workspace.id, 1, 'title', 'notes'),
    /Reload before editing/,
  )
  const unavailable = w.createWorkspaceClient('', async () => {
    throw new Error('network')
  })
  await assert.rejects(unavailable.list(), /requires the backend/)
})

test('session expiry, logout and account changes invalidate private state and in-flight bodies', async () => {
  const store = createSessionStore()
  let notifications = 0
  const stop = store.subscribe(() => notifications++)
  store.set(account)
  const first = store.getSnapshot().epoch
  store.set(null)
  assert.equal(store.getSnapshot().user, null)
  assert.ok(store.getSnapshot().epoch > first)
  store.set({ ...account, id: 2 })
  assert.equal(notifications, 3)
  stop()
  session.set(account)
  let resolve
  const client = w.createWorkspaceClient(
    '',
    async () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = client.get(workspace.id)
  session.set({ ...account, id: 2 })
  resolve(new Response(JSON.stringify(workspace)))
  await assert.rejects(pending, /Account changed/)
  const expired = w.createWorkspaceClient(
    '',
    async () =>
      new Response(
        JSON.stringify({ detail: 'Session expired. Please log in again.' }),
        { status: 401 },
      ),
  )
  await assert.rejects(expired.list(), /Session expired/)
  assert.equal(session.getSnapshot().user, null)
})

test('late JSON bodies cannot restore a logged-out account or return old private research', async () => {
  session.set(account)
  let finishBody
  let bodyStarted
  const started = new Promise((done) => {
    bodyStarted = done
  })
  const late = w.createWorkspaceClient('', async () => ({
    status: 200,
    ok: true,
    json: () => {
      bodyStarted()
      return new Promise((done) => {
        finishBody = done
      })
    },
  }))
  const pending = late.get(workspace.id)
  await started
  session.set(null)
  finishBody(workspace)
  await assert.rejects(pending, /Account changed/)

  session.set(account)
  const originalFetch = globalThis.fetch
  let finishAuth
  let authStarted
  const authBody = new Promise((done) => {
    authStarted = done
  })
  globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    json: () => {
      authStarted()
      return new Promise((done) => {
        finishAuth = done
      })
    },
  })
  try {
    const { auth } = await import(urls.auth)
    const me = auth.me()
    await authBody
    session.set(null)
    finishAuth({ user: account })
    await assert.rejects(me, /Account changed/)
    assert.equal(session.getSnapshot().user, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('workspace integration uses safe rendering, authenticated epoch keys and valid-result save guards', async () => {
  for (const file of [
    'pages/ResearchPage.tsx',
    'components/SaveResearch.tsx',
    'components/WorkspaceBoundary.tsx',
  ]) {
    const source = await readFile(
      new URL(`../src/${file}`, import.meta.url),
      'utf8',
    )
    assert.doesNotMatch(
      source,
      /dangerouslySetInnerHTML|localStorage|sessionStorage|caches\.put/,
    )
    assert.match(source, /epoch/)
  }
  for (const file of [
    'RelativeValuePage',
    'TermStructurePage',
    'BacktestPage',
  ]) {
    const source = await readFile(
      new URL(`../src/pages/${file}.tsx`, import.meta.url),
      'utf8',
    )
    assert.match(source, /researchCandidate/)
    assert.match(source, /restoredExpiry/)
    assert.match(source, /useWorkspace/)
  }
})
