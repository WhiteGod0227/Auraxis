// Creates a private, silent, captioned WebM from real local app screens.
// Requires dedicated QA Chrome on 9223 and the existing preview/backend.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { localBrowser, localTarget } from './local-browser.mjs'

const browser = await localBrowser(await localTarget())
let encoder
let encodingTarget
const scenes = []
const output = fileURLToPath(
  new URL('../../deployment-private/demo-backup/', import.meta.url),
)
try {
  await browser.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const capture = async (path, title, caption, scroll, expand) => {
    await browser.navigate(path)
    await browser.waitFor(
      `!!document.querySelector('h1') && !document.querySelector('.inline-loading-state')`,
    )
    if (path.startsWith('/app/demo'))
      await browser.waitFor(
        `!!document.querySelector('.demo-context select')?.value && !document.querySelector('.error-notice')`,
      )
    if (expand) await browser.evaluate(expand)
    if (scroll)
      await browser.evaluate(
        `document.querySelector(${JSON.stringify(scroll)}).scrollIntoView({block:'start',behavior:'instant'})`,
      )
    const image = await browser.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 90,
    })
    scenes.push({ title, caption, image: image.data })
  }
  await capture(
    '/',
    'Auraxis: follow the evidence',
    'LOCAL HISTORICAL DEMO | Compare units, inspect assumptions, and test costs.',
    '.landing-hero',
  )
  await capture(
    '/app/demo?step=1',
    '1 / Compare one common expiry',
    'A normalized price gap is a research question, not executable arbitrage.',
    '.demo-stage',
  )
  await capture(
    '/app/demo?step=2',
    '2 / Trace the calculation',
    'Inspect quote quantities, source dates and full-precision inputs.',
    '.comparison-explanation details:nth-of-type(2)',
    `document.querySelectorAll('.comparison-explanation details').forEach(d=>d.open=true)`,
  )
  await capture(
    '/app/demo?step=3',
    '3 / Costs and unfinished positions',
    'Read gross, costs and net together. Marked P&L is not realized profit.',
    '.demo-stage',
  )
  await capture(
    '/app/demo?step=4',
    '4 / Save the applied research',
    'Saving needs your account and backend. Reopening recalculates; results are not frozen.',
    '.demo-stage',
  )
  await capture(
    '/app/alerts',
    'Historical threshold alerts',
    'Browser-local rules; checked on page open or refresh. No background/live notification service.',
    '.alerts-page',
  )
  assert.deepEqual(browser.errors, [])
  encodingTarget = await (
    await fetch('http://localhost:9223/json/new?about:blank', { method: 'PUT' })
  ).json()
  encoder = await localBrowser(encodingTarget)
  await encoder.evaluate(`window.demoScenes=${JSON.stringify(scenes)}`)
  console.log(
    'Captured 6 real app screens; encoding a 42-second private captioned video...',
  )
  const data = await encoder.evaluate(`(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=800;document.body.append(canvas);
    const ctx=canvas.getContext('2d');const images=await Promise.all(window.demoScenes.map(scene=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='data:image/jpeg;base64,'+scene.image})));
    const stream=canvas.captureStream(15);const type=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:1800000});const chunks=[];
    recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)};
    const finished=new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject});
    let current=0;let frame=0;
    const draw=()=>{ctx.fillStyle='#090c12';ctx.fillRect(0,0,1280,800);ctx.drawImage(images[current],0,0,1280,720);ctx.fillStyle='#111722';ctx.fillRect(0,720,1280,80);ctx.fillStyle='#eec77c';ctx.font='bold 20px system-ui';ctx.fillText(window.demoScenes[current].title,24,748);ctx.fillStyle='#d5deed';ctx.font='16px system-ui';ctx.fillText(window.demoScenes[current].caption,24,778);ctx.fillStyle='#eec77c';ctx.fillRect(0,797,1280*(frame/630),3);frame++};
    draw();recorder.start();const timer=setInterval(draw,1000/15);
    for(let index=0;index<images.length;index++){current=index;await new Promise(resolve=>setTimeout(resolve,7000))}
    clearInterval(timer);recorder.stop();await finished;stream.getTracks().forEach(track=>track.stop());
    return await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(new Blob(chunks,{type:'video/webm'}))});
  })()`)
  const bytes = Buffer.from(data.split(',')[1], 'base64')
  assert.ok(bytes.length > 10000, 'Video encoder produced content')
  assert.equal(
    bytes.subarray(0, 4).toString('hex'),
    '1a45dfa3',
    'WebM container header',
  )
  await mkdir(output, { recursive: true })
  await writeFile(`${output}/auraxis-demo.webm`, bytes)
  await writeFile(
    `${output}/captions.json`,
    JSON.stringify(
      scenes.map(({ title, caption }, index) => ({
        start_seconds: index * 7,
        end_seconds: (index + 1) * 7,
        title,
        caption,
      })),
      null,
      2,
    ),
  )
  await writeFile(
    `${output}/README.txt`,
    'PRIVATE LOCAL DEMO. Contains historical market displays; do not publish without permission. Silent 42-second captioned walkthrough from actual local app screens. Save/sign-in is shown signed out; no account creation or private-save completion is simulated.\n',
  )
  console.log(
    `Saved ${output}/auraxis-demo.webm (${bytes.length} bytes). Not published.`,
  )
} finally {
  if (encodingTarget)
    await browser
      .send('Target.closeTarget', { targetId: encodingTarget.id })
      .catch(() => {})
  encoder?.close()
  browser.close()
}
