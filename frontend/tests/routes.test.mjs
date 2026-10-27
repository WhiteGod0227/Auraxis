import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdir, readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import ts from 'typescript'

// Render actual routes/components without pretending this is a browser layout test.
const base = fileURLToPath(new URL('../', import.meta.url))
const cache = join(base, 'node_modules', '.cache')
await mkdir(cache, { recursive: true })
const output = await mkdtemp(join(cache, 'auraxis-route-test-'))
const sourceRoot = join(base, 'src')
async function compile(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) await compile(path)
    else if (/\.(ts|tsx)$/.test(path) && !path.endsWith('main.tsx')) {
      const target = join(output, relative(sourceRoot, path)).replace(
        /\.tsx?$/,
        '.mjs',
      )
      await mkdir(dirname(target), { recursive: true })
      const source = (await readFile(path, 'utf8')).replace(
        /^import ['"][^'"]+\.css['"];?\r?\n/gm,
        '',
      )
      let result = ts.transpileModule(source, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      }).outputText
      const modulePath = (quote, name) => {
        const resolved = name.startsWith('@/')
          ? pathToFileURL(join(output, name.slice(2))).href
          : name
        return `${quote}${resolved}.mjs${quote}`
      }
      result = result
        .replace(
          /from (['"])(@\/[^'"]+|\.[^'"]+)\1/g,
          (_, quote, name) => `from ${modulePath(quote, name)}`,
        )
        .replace(
          /import\((['"])(@\/[^'"]+|\.[^'"]+)\1\)/g,
          (_, quote, name) => `import(${modulePath(quote, name)})`,
        )
      await writeFile(target, result)
    }
  }
}
await compile(sourceRoot)
const { default: App } = await import(
  pathToFileURL(join(output, 'App.mjs')).href
)

test('research context keeps historical date, online/offline source and experimental status explicit', async () => {
  const { default: DataContext } = await import(
    pathToFileURL(join(output, 'components/DataContext.mjs')).href
  )
  const render = (props) =>
    renderToStaticMarkup(React.createElement(DataContext, props))
  const online = render({
    date: '2026-10-01',
    source: 'API',
    experimental: false,
  })
  assert.doesNotMatch(
    online,
    /Historical|01 Oct 2026|Data details|Connected service/,
  )
  assert.doesNotMatch(online, /source-badge|Data source: API/)
  assert.doesNotMatch(online, /Experimental purity adjustment/)
  const offline = render({
    date: null,
    source: 'Offline snapshot',
    experimental: true,
  })
  assert.match(offline, /Offline snapshot/)
  assert.match(offline, /Experimental purity adjustment/)
  assert.match(offline, /unverified/)
})

test('saved research has one actionable empty state and pagination only when needed', async () => {
  const { ResearchResults } = await import(
    pathToFileURL(join(output, 'pages/ResearchPage.mjs')).href
  )
  const render = (data) =>
    renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(ResearchResults, {
          data,
          offset: 0,
          onPage: () => {},
          refresh: () => {},
        }),
      ),
    )
  const empty = render({ items: [], total: 0, limit: 20, offset: 0 })
  assert.equal((empty.match(/No saved research yet\./g) ?? []).length, 1)
  assert.match(empty, /href="\/app\/relative-value"/)
  assert.doesNotMatch(empty, /0 saved|Research pagination|Page 1/)
  const item = {
    id: '00112233-4455-4677-8899-aabbccddeeff',
    title: 'Sample research',
    notes: '',
    configuration_version: 1,
    configuration: { kind: 'backtest' },
    saved_context: { data_as_of: '2026-10-01', source: 'API' },
    revision: 1,
    updated_at: '2026-10-25T00:00:00Z',
  }
  assert.doesNotMatch(
    render({ items: [item], total: 1, limit: 20, offset: 0 }),
    /Research pagination/,
  )
  assert.match(
    render({ items: [item], total: 21, limit: 20, offset: 0 }),
    /Research pagination/,
  )
})

test('save action stays compact and selection policy is disclosed without exposing an unopened form', async () => {
  const { default: SaveResearch } = await import(
    pathToFileURL(join(output, 'components/SaveResearch.mjs')).href
  )
  const { session } = await import(
    pathToFileURL(join(output, 'lib/auth.mjs')).href
  )
  session.set({ id: 42, name: 'Test account', email: 'test@example.test' })
  try {
    const candidate = {
      title: '',
      notes: '',
      configuration_version: 1,
      configuration: {
        kind: 'relative_value',
        query: {},
        expiry: { mode: 'latest', value: null },
      },
      saved_context: { data_as_of: '2026-10-01', source: 'API' },
    }
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SaveResearch, { candidate }),
      ),
    )
    assert.match(html, /Save research/)
    assert.match(html, /aria-expanded="false"/)
    assert.match(html, /<details class="research-reopen-details">/)
    assert.match(html, /latest eligible contract/)
    assert.doesNotMatch(
      html,
      /class="panel research-save"|<form|Wait for a valid selected result|Private workspaces require/,
    )
    const loading = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(SaveResearch),
      ),
    )
    assert.match(loading, /disabled=""/)
  } finally {
    session.set(null)
  }
})

for (const [path, heading] of [
  ['/', /Same gold/],
  ['/app', /Overview/],
  ['/app/relative-value', /Explain this comparison/],
  ['/app/term-structure', /Term Structure/],
  ['/app/backtest', /Backtest/],
  ['/app/data-health', /Data Health/],
  ['/app/calendar', /Data Coverage/],
  ['/app/research', /My Research/],
  ['/app/profile', /My Profile/],
  ['/app/methodology', /Methodology/],
  ['/login', /Welcome back/],
]) {
  test(`actual route ${path} renders its initial state without a component crash`, () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(App),
      ),
    )
    assert.match(html, heading)
    assert.doesNotMatch(
      html,
      /could not display this page|Account access is not enabled|Preview login/,
    )
  })
}

test('private workspace titles and notes render as plain text, not HTML', async () => {
  const { WorkspaceEditor } = await import(
    pathToFileURL(join(output, 'pages/ResearchPage.mjs')).href
  )
  const workspace = {
    id: '00112233-4455-4677-8899-aabbccddeeff',
    title: '<script>alert(1)</script>',
    notes: '<img src=x onerror=alert(1)>',
    configuration_version: 1,
    configuration: { kind: 'backtest' },
    saved_context: { data_as_of: '2026-10-01', source: 'API' },
    revision: 1,
    updated_at: '2026-10-22T00:00:00Z',
  }
  const html = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(WorkspaceEditor, { workspace, refresh: () => {} }),
    ),
  )
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(html, /<script>|<img src=x/)
  assert.match(html, /Rename \/ edit notes/)
})

test('profile renders private fields safely, account menus link to it, and sign-out removes private markup', async () => {
  const { ProfileDetails } = await import(
    pathToFileURL(join(output, 'pages/ProfilePage.mjs')).href
  )
  const { default: AccountMenu } = await import(
    pathToFileURL(join(output, 'components/AccountMenu.mjs')).href
  )
  const { session } = await import(
    pathToFileURL(join(output, 'lib/auth.mjs')).href
  )
  const profile = {
    id: 42,
    name: 'आयुष <script>',
    email: 'profile@example.test',
    created_at: null,
  }
  session.set(profile)
  const render = (element) =>
    renderToStaticMarkup(React.createElement(MemoryRouter, null, element))
  const html = render(React.createElement(ProfileDetails, { profile }))
  assert.match(html, /Registered email/)
  assert.match(html, /profile@example.test/)
  assert.match(html, /Unavailable/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Edit name/)
  assert.match(html, /Sign out/)
  assert.doesNotMatch(html, /Verified email|<script>/)
  const menu = render(React.createElement(AccountMenu))
  assert.match(menu, /href="\/app\/profile"/)
  assert.match(menu, /href="\/app\/research"/)
  session.set(null)
  const signedOut = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ['/app/profile'] },
      React.createElement(App),
    ),
  )
  assert.match(signedOut, /Sign in to view your private profile/)
  assert.doesNotMatch(signedOut, /profile@example.test|आयुष/)
})
