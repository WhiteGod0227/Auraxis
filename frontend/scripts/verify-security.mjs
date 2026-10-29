// Real private API requests are redirected to the disposable QA backend on 8011.
// Run backend/scripts/run_security_qa.py first. Never redirect to a real account store.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { localBrowser, localTarget } from './local-browser.mjs'

const browser = await localBrowser(await localTarget())
const { send, evaluate, waitFor, navigate } = browser
const email = `security-${Date.now()}@example.test`
const password = 'Disposable-test-pass-123'
function otp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret)
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const bytes = Buffer.from(
    bits.match(/.{8}/g).map((binary) => parseInt(binary, 2)),
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)))
  const hash = createHmac('sha1', bytes).update(counter).digest()
  return String(
    (hash.readUInt32BE(hash[hash.length - 1] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, '0')
}
browser.events.add((message) => {
  if (message.method === 'Fetch.requestPaused')
    send('Fetch.continueRequest', {
      requestId: message.params.requestId,
      url: message.params.request.url.replace(
        'localhost:8010',
        'localhost:8011',
      ),
    }).catch((error) => browser.errors.push(error.message))
})
const fill = async (selector, value) =>
  evaluate(
    `(()=>{const input=document.querySelector(${JSON.stringify(selector)});const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  )
const click = async (text) =>
  evaluate(
    `Array.from(document.querySelectorAll('button')).find(button=>button.textContent===${JSON.stringify(text)}).click()`,
  )
let codes
try {
  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*://localhost:8010/api/auth/*' },
      { urlPattern: '*://localhost:8010/api/alerts/*' },
    ],
  })
  await navigate('/login')
  await waitFor(`!!document.querySelector('.signup_tog')`)
  await click('Sign up')
  await waitFor(`!document.querySelector('#signup-face').inert`)
  await fill('#signup-face input[name=name]', 'Disposable QA')
  await fill('#signup-face input[name=email]', email)
  await fill('#signup-face input[name=password]', password)
  await evaluate(`document.querySelector('#signup-face').requestSubmit()`)
  await waitFor(`location.pathname==='/'`)
  await navigate('/app/security')
  await waitFor(`!!document.querySelector('#security-password')`)
  await fill('#security-password', password)
  await click('Set up authenticator')
  await waitFor(`!!document.querySelector('.security-secret code')`)
  const secret = await evaluate(
    `document.querySelector('.security-secret code').textContent`,
  )
  await fill('#security-code', otp(secret))
  await click('Confirm authenticator')
  await waitFor(`!!document.querySelector('.security-secret pre')`)
  codes = (
    await evaluate(`document.querySelector('.security-secret pre').textContent`)
  ).split('\n')
  assert.equal(codes.length, 8)
  await waitFor(
    `document.querySelector('.security-panel').textContent.includes('Enabled')`,
  )
  for (const width of [1440, 390, 320]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await evaluate(
      `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
    )
    assert.ok(
      await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`),
    )
  }
  // Password plus recovery-code login exercises the real MFA check without waiting for a time-step rollover.
  await navigate('/login')
  await fill('#login-face input[name=email]', email)
  await fill('#login-face input[name=password]', password)
  await fill('#login-face input[name=otp]', codes[0])
  await evaluate(`document.querySelector('#login-face').requestSubmit()`)
  await waitFor(`location.pathname==='/'`)
  await navigate('/app/alerts')
  await waitFor(`document.body.textContent.includes('0 saved account rules')`)
  await evaluate(`document.querySelector('form.alert-form').requestSubmit()`)
  await waitFor(`!!document.querySelector('.alert-card')`)
  await click('Merge browser rules into account')
  await waitFor(`document.body.textContent.includes('1 saved account rules')`)
  await navigate('/app/alerts')
  await waitFor(`document.body.textContent.includes('1 saved account rules')`)
  await evaluate(
    `document.querySelector('.alert-card .alert-actions button').click()`,
  )
  await waitFor(`document.body.textContent.includes('No alerts yet')`)
  await click('Use account rules in this browser')
  await waitFor(`!!document.querySelector('.alert-card')`)
  await navigate('/app/recover')
  await waitFor(`!!document.querySelector('#recover-email')`)
  await fill('#recover-email', email)
  await fill('#recover-code', codes[1])
  await fill('#recover-password', 'Changed-test-pass-123')
  await evaluate(
    `document.querySelector('.security-panel form').requestSubmit()`,
  )
  await waitFor(
    `document.body.textContent.includes('Password reset. All sessions revoked.')`,
  )
  await navigate('/login')
  await fill('#login-face input[name=email]', email)
  await fill('#login-face input[name=password]', 'Changed-test-pass-123')
  await fill('#login-face input[name=otp]', codes[2])
  await evaluate(`document.querySelector('#login-face').requestSubmit()`)
  await waitFor(`location.pathname==='/'`)
  assert.deepEqual(browser.errors, [])
  await mkdir('node_modules/.cache/security-review', { recursive: true })
  await writeFile(
    'node_modules/.cache/security-review/results.json',
    JSON.stringify(
      {
        privateAPI: 'real isolated backend 8011',
        signup: 'passed',
        mfa: 'enrollment and recovery-code login passed',
        recovery: 'password reset and MFA preserved',
        accountAlerts: 'save reload restore passed',
        widths: [1440, 390, 320],
        runtimeErrors: browser.errors,
      },
      null,
      2,
    ),
  )
  console.log(
    'PASS: real isolated signup/MFA/login/recovery/account alerts; mobile layouts; no runtime exceptions. No real accounts changed.',
  )
} finally {
  await evaluate(`localStorage.removeItem('auraxis.research-alerts.v1')`).catch(
    () => {},
  )
  browser.close()
}
