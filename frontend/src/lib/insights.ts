/**
 * Plain-English insights, written from the numbers by fixed rules (no AI),
 * so every sentence can be traced to a figure on screen. Text uses
 * **double asterisks** for emphasis; <InsightList> renders it.
 */
import type { PairSummary, Reference, SpreadRow } from './types'
import {
  gapLevel,
  grams,
  inr,
  longDate,
  pairLabel,
  pairParts,
  shortDate,
} from './insight'

export type InsightTone = 'high' | 'low' | 'normal' | 'note' | 'caution'
export interface Insight {
  tone: InsightTone
  text: string
}

const pct = (value: number, digits = 1) => `${Math.abs(value).toFixed(digits)}%`
const sigma = (z: number) => `${z > 0 ? '+' : '−'}${Math.abs(z).toFixed(1)}σ`
const unusual = (z: number | null | undefined) =>
  typeof z === 'number' && Math.abs(z) >= 2

function rankPhrase(percentile: number | null, span: number) {
  if (typeof percentile !== 'number') return ''
  if (percentile >= 99.5) return `the highest of the last ${span} sessions`
  if (percentile <= 0.5) return `the lowest of the last ${span} sessions`
  return percentile >= 50
    ? `higher than ${Math.round(percentile)}% of the last ${span} sessions`
    : `lower than ${Math.round(100 - percentile)}% of the last ${span} sessions`
}

function gapSentence(pair: string, spread: number) {
  const [a, b] = pairParts(pair)
  if (Math.abs(spread) < 1)
    return `**${a}** and **${b}** cost the same per 10 g`
  return `**${a}** is **${inr(Math.abs(spread))} ${spread > 0 ? 'dearer' : 'cheaper'}** than **${b}** per 10 g`
}

/** Overview: what stands out in the latest session. */
export function overviewInsights({
  references,
  pairs,
  sessions,
  span,
  asOf,
}: {
  references: Reference[]
  pairs: PairSummary[]
  sessions: number | null
  span: number
  asOf?: string | null
}): Insight[] {
  const out: Insight[] = []
  const ranked = pairs.filter((p) => typeof p.z === 'number')
  const flagged = ranked
    .filter((p) => unusual(p.z))
    .sort((x, y) => Math.abs(y.z!) - Math.abs(x.z!))

  if (ranked.length) {
    const top = flagged[0]
    if (top && typeof top.spread_abs === 'number') {
      out.push({
        tone: top.z! > 0 ? 'high' : 'low',
        text: `${gapSentence(top.pair, top.spread_abs)} — ${rankPhrase(top.percentile, span)} (${sigma(top.z!)}).`,
      })
    } else {
      out.push({
        tone: 'normal',
        text: 'No gap is unusual today: every pair is within **2σ** of its usual level.',
      })
    }
    if (flagged.length > 1)
      out.push({
        tone: 'note',
        text: `**${flagged.length} of ${ranked.length}** pairs are outside their usual range at the same time — usually a sign of one broad market move rather than ${flagged.length} separate opportunities.`,
      })
  } else if (pairs.length) {
    const widest = [...pairs].sort(
      (x, y) => Math.abs(y.spread_abs ?? 0) - Math.abs(x.spread_abs ?? 0),
    )[0]
    if (widest && typeof widest.spread_abs === 'number')
      out.push({
        tone: 'note',
        text: `The widest gap today: ${gapSentence(widest.pair, widest.spread_abs)}.`,
      })
  }

  const moves = references
    .filter((r) => typeof r.day_change_pct === 'number')
    .map((r) => r.day_change_pct as number)
  if (moves.length >= 2) {
    const lo = Math.min(...moves)
    const hi = Math.max(...moves)
    const day = asOf ? ` on ${shortDate(asOf)}` : ''
    if (lo < 0 && hi < 0)
      out.push({
        tone: 'note',
        text: `All products **fell ${pct(hi)}–${pct(lo)}**${day}. In a move this size, small differences between contracts are enough to shift the gaps.`,
      })
    else if (lo > 0 && hi > 0)
      out.push({
        tone: 'note',
        text: `All products **rose ${pct(lo)}–${pct(hi)}**${day}. In a move this size, small differences between contracts are enough to shift the gaps.`,
      })
    else
      out.push({
        tone: 'note',
        text: `Products moved in **different directions**${day} (${pct(lo)} down to ${pct(hi)} up) — that is when gaps change the most.`,
      })
  }

  const traded = references.filter((r) => (r.volume_grams ?? 0) > 0)
  const total = traded.reduce((sum, r) => sum + (r.volume_grams ?? 0), 0)
  const thinnest = [...traded].sort(
    (x, y) => (x.volume_grams ?? 0) - (y.volume_grams ?? 0),
  )[0]
  if (thinnest && total > 0) {
    const share = ((thinnest.volume_grams ?? 0) / total) * 100
    if (share < 5)
      out.push({
        tone: 'caution',
        text: `**${thinnest.product}** traded only **${grams(thinnest.volume_grams)}** (${share.toFixed(0)}% of volume). Its price can rest on a handful of trades, so gaps involving it deserve a second look.`,
      })
  }

  const soonest = references
    .filter((r) => typeof r.days_to_expiry === 'number' && r.expiry_date)
    .sort((x, y) => x.days_to_expiry! - y.days_to_expiry!)[0]
  if (soonest && soonest.days_to_expiry! <= 21)
    out.push({
      tone: 'note',
      text: `The nearest contracts expire on **${longDate(soonest.expiry_date)}** (${soonest.days_to_expiry} days). Comparisons switch to the next contract 3 days before expiry.`,
    })

  if (sessions !== null && ranked.length && sessions < 10)
    out.push({
      tone: 'caution',
      text: `Rankings use only **${span} earlier sessions**, so treat them as early signals until about 10 trading days are loaded.`,
    })
  return out
}

/** Report: what one pair's numbers say. */
export function pairInsights({
  pair,
  latest,
  rows,
  span,
  sessions,
}: {
  pair: string
  latest: SpreadRow
  rows: SpreadRow[]
  span: number
  sessions: number | null
}): Insight[] {
  const out: Insight[] = []
  const [a, b] = pairParts(pair)
  if (typeof latest.spread_abs === 'number')
    out.push({
      tone: 'note',
      text: `${gapSentence(pair, latest.spread_abs)}${
        typeof latest.spread_pct === 'number'
          ? ` — ${pct(latest.spread_pct, 2)} of the price`
          : ''
      }, after converting both to 10 g of 999 gold.`,
    })
  if (typeof latest.z === 'number') {
    const level = gapLevel(latest.z)
    out.push({
      tone:
        level.tone === 'high'
          ? 'high'
          : level.tone === 'low'
            ? 'low'
            : 'normal',
      text: `Against its own recent history the gap is **${level.chip.toLowerCase()}** (${sigma(latest.z)}): ${rankPhrase(latest.percentile, span)}.`,
    })
    if (typeof latest.roll_mean === 'number')
      out.push({
        tone: 'note',
        text: `Its recent average is **${latest.roll_mean > 0 ? '+' : '−'}${pct(latest.roll_mean, 2)}** of price; today it sits at ${latest.spread_pct! > 0 ? '+' : '−'}${pct(latest.spread_pct ?? 0, 2)}.`,
      })
  } else {
    out.push({
      tone: 'caution',
      text: `There is not yet enough history to say whether this gap is unusual (needs 6 trading days${sessions !== null ? `; ${sessions} loaded` : ''}).`,
    })
  }
  const valid = rows.filter((r) => typeof r.spread_abs === 'number')
  const first = valid[0]
  if (first && valid.length >= 3 && first.trade_date !== latest.trade_date) {
    const change = (latest.spread_abs ?? 0) - (first.spread_abs ?? 0)
    if (Math.abs(change) >= 1)
      out.push({
        tone: 'note',
        text: `Since **${shortDate(first.trade_date)}** the gap has moved by **${inr(Math.abs(change))}** (${change > 0 ? `${a} gained on ${b}` : `${b} gained on ${a}`}).`,
      })
  }
  if (latest.liquidity_reason || latest.reason)
    out.push({
      tone: 'caution',
      text: 'At least one contract traded thinly on this day, so the settlement price may not reflect a price you could actually trade at.',
    })
  if (pair.startsWith('GOLDM-'))
    out.push({
      tone: 'caution',
      text: 'GOLDM expires on different dates from the other products, so its partner is adjusted to the same maturity. Use this for analysis, not as a tradable pair.',
    })
  return out
}

export const reportTitle = (pair: string) => pairLabel(pair)
