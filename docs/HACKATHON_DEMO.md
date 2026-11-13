# Three-minute demo script

Before presenting: load at least 20 trading days of data (ideally 60), sign
in with a demo account, and open http://localhost:5180/app.

## Getting real data

MCX blocks scripted downloads, so fetch the files in a normal browser:

1. Open the MCX website → Market Data → Bhavcopy.
2. Pick a trading date and download the **date-wise** CSV
   (`BhavCopyDateWise_DDMMYYYY.csv`). Repeat for each trading day; skip
   weekends and holidays.
3. In Auraxis, open **Market data → Import** and drop all the files in at once.

What unlocks as days are added:

| Days loaded | What works |
| --- | --- |
| 1 | Prices, volumes, price ladder, gap today, futures curve (Across expiries), data health |
| 2+ | Day-on-day change, sparklines, price trend chart |
| 6+ | "How unusual" gauge, gap-vs-usual bars, gap chart, z-score alerts |
| 20+ | Backtest |

The app shows a "Building history" card with progress until each view unlocks.
Do not publish the MCX files or the database; permission to redistribute MCX
data is not confirmed.

## Demo with only a few days loaded

Lead with **Compare → Across expiries** (the futures curve works on one day),
then the Overview price ladder and "Gap today" bars. Say plainly how many days
are loaded and what unlocks next.

## Full script (20+ days loaded)

| Time | Screen | What to show | What to say |
| --- | --- | --- | --- |
| 0:00–0:25 | Landing → **Overview** | The hero card | "MCX lists four gold futures that quote different sizes. Put on one scale, they should cost the same — but they don't. Auraxis finds the gap that's most unusual today." |
| 0:25–1:00 | **Overview** | Biggest-gap card, the *All comparisons* table and its chips | "Each gap is compared with its own last 10 sessions. This one is *unusually low* — the lowest in two weeks." |
| 1:00–1:40 | **Compare → Between products** (click *Explore this gap*) | Summary sentence, the four numbers, *Gap / vs usual* chart toggle, *How is this calculated?* | "Every number is traceable: raw quotes, unit conversion, the history used." |
| 1:40–2:25 | **Backtest** | Pick *Balanced*, run, read the sentence and *Profit over time* | "Would trading this have worked? Here it is with costs — and the cost-sensitivity chart shows how fragile the edge is." |
| 2:25–3:00 | **Share report** (on the biggest-gap card) → **Download PDF** | The one-page research note with plain-English findings | "Every finding is written from the numbers and exports as a shareable PDF. Light or dark, the crow tells you when something is unusual." |

## Honest framing

- Settlement prices, not executable quotes; the backtest assumes idealized
  next-session fills.
- Location basis (ex-Mumbai vs ex-Ahmedabad) remains after unit conversion.
- Results depend on how many days are loaded; say how many.

## Backup

The guided walkthrough at **Take the tour** (`/app/demo`) runs the same story
step by step if live clicking goes wrong.
