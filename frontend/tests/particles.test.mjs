import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const folder = await mkdtemp(join(tmpdir(), 'auraxis-particles-'))
const source = (
  await readFile(
    new URL('../src/components/StarBackground.tsx', import.meta.url),
    'utf8',
  )
).replace("import '@/styles/star-background.css'", '')
const compiled = ts
  .transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  .outputText.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(import.meta.resolve('react/jsx-runtime')),
  )
  .replaceAll(
    "'react-router-dom'",
    JSON.stringify(import.meta.resolve('react-router-dom')),
  )
await writeFile(join(folder, 'stars.mjs'), compiled)
const { default: StarBackground } = await import(
  pathToFileURL(join(folder, 'stars.mjs')).href
)
const render = (path) =>
  renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(StarBackground),
    ),
  )

test('landing retains all three star layers', () => {
  const html = render('/')
  for (const name of ['small', 'medium', 'large'])
    assert.ok(html.includes(`auraxis-stars-${name}`))
})
test('all dashboard routes retain the landing gradient and stars', () => {
  for (const route of [
    '/app',
    '/app/relative-value',
    '/app/term-structure',
    '/app/backtest',
    '/app/data-health',
    '/app/calendar',
    '/app/methodology',
  ]) {
    for (const name of ['small', 'medium', 'large'])
      assert.ok(render(route).includes(`auraxis-stars-${name}`), route)
    assert.ok(render(route).includes('auraxis-star-background'), route)
  }
})
