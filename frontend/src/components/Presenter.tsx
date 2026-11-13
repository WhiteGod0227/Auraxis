import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Crow from './Crow'
import type { CrowMood } from './Crow'
import { api } from '@/lib/api'
import { presenter, usePresenter } from '@/lib/presenter'
import { inr, longDate, pairLabel, pairParts } from '@/lib/insight'
import type { PairSummary } from '@/lib/types'
import '@/styles/presenter.css'

interface Step {
  path: string
  target: string
  title: string
  say: string
  mood: CrowMood
  seconds: number
}

interface Facts {
  asOf: string | null
  sessions: number | null
  top: PairSummary | null
}

const DEFAULT_PAIR = 'GOLDTEN-GOLDPETAL'

function storyFor({ asOf, sessions, top }: Facts): Step[] {
  const pair = top?.pair ?? DEFAULT_PAIR
  const [a, b] = pairParts(pair)
  const link = `pair=${encodeURIComponent(pair)}${top?.expiry ? `&expiry=${top.expiry}` : ''}`
  const z = typeof top?.z === 'number' ? top.z : null
  const gap = typeof top?.spread_abs === 'number' ? top.spread_abs : null
  const day = asOf ? longDate(asOf) : 'the latest session'
  const backtestReady = sessions !== null && sessions >= 20
  return [
    {
      path: '/',
      target: '.lp-title',
      title: 'Same gold. Different contracts.',
      say: 'MCX lists four gold futures that quote different sizes. Put on one scale they should cost the same — Auraxis asks: when they don’t, is the gap real?',
      mood: 'perched',
      seconds: 20,
    },
    {
      path: '/app',
      target: '.ov-products',
      title: 'One price scale',
      say: `Every contract converted to ₹ per 10 g of 999 gold. These are real MCX settlement prices for ${day}.`,
      mood: 'perched',
      seconds: 20,
    },
    {
      path: '/app',
      target: '.ov-insights',
      title: 'What stands out — in plain English',
      say: 'Auraxis writes its findings straight from the numbers, with fixed rules, so every sentence traces back to a figure on screen.',
      mood: 'thinking',
      seconds: 22,
    },
    {
      path: '/app',
      target: '#ov-hero',
      title: 'The biggest unusual gap',
      say:
        z !== null && gap !== null
          ? `${a} is ${inr(Math.abs(gap))} ${gap >= 0 ? 'dearer' : 'cheaper'} than ${b} — ${z > 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}σ from its own usual level. The crow flags it; one click explains it.`
          : 'Each pair is ranked against its own recent history; the most unusual one is shown here with a gauge.',
      mood: 'alert',
      seconds: 24,
    },
    {
      path: `/app/relative-value?${link}`,
      target: '.cmp-summary',
      title: `Is the gap real? ${pairLabel(pair)}`,
      say: 'The raw prices, the conversion and the history behind every number. “How is this calculated?” shows the working, step by step.',
      mood: 'inspecting',
      seconds: 24,
    },
    {
      path: '/app/term-structure',
      target: '.ts-summary, .shell-content .ui-card',
      title: 'A sanity check: across expiries',
      say: 'Later contracts cost more — the cost of carrying gold. Seeing this proves the data behaves like real gold futures.',
      mood: 'inspecting',
      seconds: 20,
    },
    {
      path: '/app/backtest',
      target: '.bt-result, .history-gate, .cmp-summary',
      title: 'Would trading it have worked?',
      say: backtestReady
        ? 'Every simulated trade pays realistic costs. Auraxis shows the honest answer — even when the answer is “no”.'
        : `Backtests need about 20 trading days; ${sessions ?? 'only a few'} are loaded. Auraxis refuses to show a result it can’t support.`,
      mood: backtestReady ? 'celebrating' : 'thinking',
      seconds: 25,
    },
    {
      path: `/app/report?${link}`,
      target: '.report-sheet',
      title: 'Share the research',
      say: 'One click turns the analysis into a printable research note — findings, chart and caveats — ready to download as a PDF.',
      mood: 'celebrating',
      seconds: 25,
    },
  ]
}

/** Loads the latest session's facts so the narration quotes real numbers. */
function useFacts(active: boolean): Facts {
  const [facts, setFacts] = useState<Facts>({
    asOf: null,
    sessions: null,
    top: null,
  })
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    Promise.all([
      api.meta(controller.signal).catch(() => null),
      api.spreadsSummary(controller.signal).catch(() => null),
    ]).then(([meta, summary]) => {
      const pairs = summary?.data.pairs ?? []
      const ranked = pairs
        .filter((p) => typeof p.z === 'number')
        .sort((x, y) => Math.abs(y.z!) - Math.abs(x.z!))
      const widest = [...pairs].sort(
        (x, y) => Math.abs(y.spread_abs ?? 0) - Math.abs(x.spread_abs ?? 0),
      )
      setFacts({
        asOf: meta?.data.data_as_of ?? summary?.data.data_as_of ?? null,
        sessions: meta?.data.trading_session_count ?? null,
        top: ranked[0] ?? widest[0] ?? null,
      })
    })
    return () => controller.abort()
  }, [active])
  return facts
}

/** Judge-facing demo: walks the story page by page with captions. */
export default function Presenter() {
  const { active, step, auto } = usePresenter()
  const facts = useFacts(active)
  const steps = useMemo(() => storyFor(facts), [facts])
  const navigate = useNavigate()
  const location = useLocation()
  const current = steps[Math.min(step, steps.length - 1)]
  const last = step >= steps.length - 1
  const here = `${location.pathname}${location.search}`

  // When the step changes, open its page (clicking around freely is fine).
  const path = current?.path
  useEffect(() => {
    if (active && path) navigate(path)
  }, [active, step, path, navigate])

  // On the step's page, bring its card into view and highlight it.
  useEffect(() => {
    if (!active || !current || here !== current.path) return
    let spot: Element | null = null
    let tries = 0
    let timer = 0
    // Pages load their data at different speeds: keep looking for ~8 s.
    const look = () => {
      spot = document.querySelector(current.target)
      if (spot) {
        spot.classList.add('demo-spot')
        // Centre the card in the space above the caption dock.
        const dock = document.querySelector('.demo-dock')
        const free =
          window.innerHeight - (dock?.getBoundingClientRect().height ?? 0) - 40
        const box = spot.getBoundingClientRect()
        const offset = box.height < free ? (free - box.height) / 2 : 24
        window.scrollTo({
          top: Math.max(0, box.top + window.scrollY - offset),
          behavior: 'smooth',
        })
      } else if (++tries < 26) timer = window.setTimeout(look, 300)
    }
    timer = window.setTimeout(look, 700)
    return () => {
      window.clearTimeout(timer)
      spot?.classList.remove('demo-spot')
    }
  }, [active, current, here])

  // Auto-play paces the story; it stops on the last step.
  useEffect(() => {
    if (!active || !auto || !current) return
    const timer = window.setTimeout(() => {
      if (last) presenter.setAuto(false)
      else presenter.go(step + 1)
    }, current.seconds * 1000)
    return () => window.clearTimeout(timer)
  }, [active, auto, current, last, step])

  // Keyboard: → / Space next, ← back, P play/pause, Esc exit.
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return
      if (event.key === 'Escape') presenter.stop()
      else if (event.key === 'ArrowRight' || event.key === ' ') {
        event.preventDefault()
        if (!last) presenter.go(step + 1)
      } else if (event.key === 'ArrowLeft') {
        if (step > 0) presenter.go(step - 1)
      } else if (event.key.toLowerCase() === 'p') presenter.setAuto(!auto)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, auto, last, step])

  if (!active || !current) return null
  return (
    <aside
      className="demo-dock"
      role="dialog"
      aria-modal="false"
      aria-label="Demo mode"
      aria-live="polite"
    >
      <div className="demo-progress" aria-hidden="true">
        {steps.map((_, index) => (
          <span
            key={index}
            className={index < step ? 'done' : index === step ? 'now' : ''}
          >
            {index === step && auto && (
              <i
                key={`${step}-${auto}`}
                style={{ animationDuration: `${current.seconds}s` }}
              />
            )}
          </span>
        ))}
      </div>
      <div className="demo-body">
        <Crow size={64} mood={current.mood} className="demo-crow" />
        <div className="demo-text">
          <p className="demo-count">
            Step {step + 1} of {steps.length}
          </p>
          <h2>{current.title}</h2>
          <p>{current.say}</p>
        </div>
      </div>
      <div className="demo-controls">
        <button
          type="button"
          className="ui-button"
          onClick={() => presenter.go(step - 1)}
          disabled={step === 0}
        >
          ← Back
        </button>
        <button
          type="button"
          className="ui-button"
          onClick={() => presenter.setAuto(!auto)}
          aria-pressed={auto}
          title="Auto-play (P)"
        >
          {auto ? '❚❚ Pause' : '▶ Auto-play'}
        </button>
        <span className="demo-spacer" />
        <button
          type="button"
          className="ui-button"
          onClick={() => presenter.stop()}
        >
          Exit
        </button>
        <button
          type="button"
          className="ui-button primary"
          onClick={() => (last ? presenter.stop() : presenter.go(step + 1))}
        >
          {last ? 'Finish' : 'Next →'}
        </button>
      </div>
    </aside>
  )
}
