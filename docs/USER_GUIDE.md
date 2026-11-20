# Auraxis user guide

Auraxis is a research dashboard for **MCX gold futures** — GOLDM, GOLDTEN,
GOLDGUINEA and GOLDPETAL. It answers one question: *the same gold trades in
four different contracts — is the price gap between them unusual right now?*

Live site: **https://auraxis-ten.vercel.app**

> Auraxis is a research and learning tool. It does not place real trades and
> nothing in it is investment advice. Demo money (◎) has no cash value.

---

## Contents

1. [Getting started](#1-getting-started)
2. [Finding your way around](#2-finding-your-way-around)
3. [Key ideas in two minutes](#3-key-ideas-in-two-minutes)
4. [Overview](#4-overview)
5. [Compare](#5-compare)
6. [Backtest](#6-backtest)
7. [Practice (demo money)](#7-practice-demo-money)
8. [Alerts](#8-alerts)
9. [Data](#9-data)
10. [Research, reports and sharing](#10-research-reports-and-sharing)
11. [On-chain gold (Web3)](#11-on-chain-gold-web3)
12. [Proof of research (Bitcoin timestamps)](#12-proof-of-research-bitcoin-timestamps)
13. [Your account, security and wallet](#13-your-account-security-and-wallet)
14. [Learn: methodology, tour and demo](#14-learn-methodology-tour-and-demo)
15. [Live versus settled prices](#15-live-versus-settled-prices)
16. [Glossary](#16-glossary)
17. [FAQ and troubleshooting](#17-faq-and-troubleshooting)

---

## 1. Getting started

1. Open the site. The **landing page** shows the idea in one screen; press
   **Open dashboard**.
2. Most pages work without an account. **Create an account** (top-right
   **Log in** → *Create account*, or *Continue with Google* where offered) to:
   - get **◎ 10,00,000 of demo money** for practice trading,
   - **save research** and sync **alerts** across devices,
   - receive **Bitcoin proofs** for your work,
   - optionally **link a wallet**.
3. New to the subject? Take the **Guided tour** (top bar → **More**) — eight
   short steps using today's real numbers.

---

## 2. Finding your way around

### The top bar

| Item | What it does |
| --- | --- |
| **Auraxis** logo | Back to the Overview. |
| **Search** (press **/** anywhere) | Jump to a product, a pair or any page. Use ↑ ↓ and **Enter**; **Esc** closes. |
| **Overview · Compare · Backtest · Practice · Alerts · Data · Research** | The main pages. |
| **More ▾** | On-chain gold, Proof of research, Methodology, Guided tour, Present demo. |
| **◎ balance** | Your demo-money account value (signed in). Click to open Practice. |
| **Status pill** | **Live · 20 Nov** while MCX trades; **MCX closed · …** after the close; **Settled to …** otherwise. **↻** refreshes market data (signed in). |
| ☾ / ☀ | Dark or light theme. |
| Pointer icon | Turns the crow mouse pointer on or off. |
| **Log in** / avatar | Sign in, or open the account menu (Profile, My Research, Security, Sign out). |

On phones the links and search move into the **☰ menu**.

---

## 3. Key ideas in two minutes

- **One price scale.** Every contract is converted to **₹ per 10 g**, so
  GOLDPETAL (quoted per 1 g), GOLDGUINEA (per 8 g) and GOLDTEN/GOLDM (per
  10 g) can be compared directly.
- **Gap.** For a pair such as *GOLDTEN vs GOLDPETAL*, the gap is the first
  product's price minus the second's, per 10 g. Positive means the first is
  dearer.
- **Is it unusual? (σ).** Each gap is compared with its own **previous 10
  settlement sessions**: how many standard deviations (σ) it is from its
  average.
  - within ±1σ → **Normal**
  - beyond ±1σ → **Above / Below usual**
  - beyond ±2σ → **Unusually high / low**
- **Contracts and expiry.** Each product has several monthly contracts.
  Auraxis compares the **nearest contract at least 3 days from expiry**.
  GOLDM expires on different dates from the others, so GOLDM pairs are
  compared at a matched maturity (interpolated) — useful for analysis, not a
  directly tradable pair.
- **Costs matter.** Backtests and practice trades charge **5 bps per leg
  per side** by default, because small gaps are often eaten by costs.

---

## 4. Overview

The home of the dashboard. During market hours it shows **today's live
figures**; after the session it shows the latest **settlement** (see
[Live versus settled](#15-live-versus-settled-prices)).

| Area | How to use it |
| --- | --- |
| **Header badge** | *LIVE · Fri 20 Nov · updated 12 s ago*, *CLOSED · … settlement pending*, or *SETTLED · date*. The chip beside it counts unusual gaps today — click it to jump to Pair check. |
| **Product picker** (left) | Choose GOLDM, GOLDTEN, GOLDGUINEA or GOLDPETAL; the menu also lists every product's price and change. |
| **Stats strip** | Price per 10 g, change since the last close, volume today, open interest, the product's share of all gold volume, expiry (days left) and last trade time. |
| **Main chart** | Price (or **Open interest**) of the nearest contract with daily **volume** bars. Toggle **Volume** and **All products**; pick **1M 3M 6M 1Y All**. Hover for exact values. During a session the last point is live. |
| **Pair check** (right) | Pick a pair: live gap per 10 g, a σ slider from −3 to +3, rank versus the last 10 sessions, change since the last close and both prices. **Explore this gap** opens Compare; **Practise this gap with demo money** opens a pre-filled practice ticket (same-expiry pairs only). |
| **All comparisons** | All six pairs ranked by how unusual they are. **Click** a row to load it into Pair check; **double-click** or **Enter** opens it in Compare. |
| **Gap trend** | The selected pair's gap over the last 10 or 30 sessions. |
| **What stands out** | Plain-English findings written from the numbers by fixed rules (no AI). |

---

## 5. Compare

Two views, switched at the top right.

### Between products
1. Choose a **Pair**, a **Contract expiry** and **Compare with last** (how
   many sessions define "usual", 5–30).
2. **More options**: *Purity adjustment* (experimental) and, for GOLDM pairs,
   *Match maturities*.
3. Read the summary card (both prices, the gap, its share of price) and the
   **σ gauge** with its rank.
4. **Gap over time** shows the gap, its recent average and the usual range;
   switch to **vs usual** to see the σ series.
5. **How is this calculated?** expands every input of the latest figure.

### Across expiries
1. Choose a **Product** and **Curve as of** (a date).
2. The **futures curve** shows each contract's price; upward curves mean
   later delivery costs more (cost of carry).
3. **What moved the price** splits a contract's change into roll-down (time
   passing along the curve) and everything else.

Both views have **Save research** (signed in) and **Share report**.

---

## 6. Backtest

Tests a simple rule: *when a gap is unusual, bet that it returns to normal*,
including trading costs.

1. Choose a **Pair** and a **Strategy** preset:
   - **Cautious** — enters beyond ±2σ, exits inside ±0.5σ (trades least),
   - **Balanced** — enters beyond ±1.5σ, exits inside ±0.25σ,
   - **Active** — enters beyond ±1σ, exits inside ±0.25σ (trades most).
   Every preset also exits after a maximum number of sessions (5 by default).
2. **Advanced settings**: enter/exit levels (σ), maximum holding sessions,
   minimum volume, cost (bps per leg per side), sizing.
3. Press **Run backtest**, then read:
   - the **verdict** — *profitable after costs*, *made money before costs but
     costs turned it into a loss*, or *lost money even before costs*,
   - **where the money went** — profit before costs, costs, net,
   - **cumulative profit** before and after costs,
   - **each completed trade**,
   - **cost sensitivity** with the break-even cost marked.

The backtest needs about **20 trading days** of history.

---

## 7. Practice (demo money)

Practise on real MCX prices without risk. Every account starts with
**◎ 10,00,000** — demo money with **no cash value** that cannot be bought,
withdrawn or sent to anyone.

### Placing a trade
1. Open **Practice** (or **Practise this gap** from the Overview).
2. In the ticket choose **Pair** or **Product**:
   - **Pair** (GOLDTEN–GOLDPETAL, GOLDTEN–GOLDGUINEA, GOLDGUINEA–GOLDPETAL):
     **Gap to fall** sells the first product and buys the second; **Gap to
     rise** does the opposite. The suggestion follows the rule that unusual
     gaps tend to move back toward usual.
   - **Product**: **Buy** profits if the price rises; **Sell** if it falls.
     GOLDM is practised here.
3. Set the **size in grams** (it steps in whole lots; quick sizes below).
4. Check **Trade value**, **Margin held** (10%), **Entry cost** and
   **Available**, then **Place practice trade**.

Trades fill at the **live last-traded price** and only while MCX is open
(09:00–23:55 IST, Mon–Fri). Contracts that have not traded today are refused
because their price is stale.

### Managing trades
- **Open trades** update every 30 s: entry, now, profit/loss and what
  closing now would give **after both costs**. Press **Close** (market open).
- Trades still open at **expiry** close automatically at the last settlement.
- **History** lists closed trades after costs; **Bitcoin proofs →** shows
  their certificates.
- The wallet strip shows account value, return, cash, open P&L, margin held,
  available money and win rate.
- **Reset demo money** starts over (clears trades and history).

### Achievements and leaderboard
Five achievements (first trade, pair trader, gap hunter, in the green,
regular) and a **last 7 days** summary. The **leaderboard** is opt-in: choose
a display name and **Join**; only that name and your return are shown. You
appear after your first closed trade. **Leave leaderboard** any time.

---

## 8. Alerts

1. **New alert**: choose a pair, a contract (blank = nearest), a metric —
   **|σ| above** or **|gap %| above** — and a threshold.
2. Your alerts (up to 20) show whether each is **triggered** with today's
   numbers; **Open in Compare** jumps to the pair.
3. Alerts are kept in this browser; signed in, **Use these alerts on another
   device** syncs them to your account.

Alerts are checked when you open the page; they do not send notifications.

---

## 9. Data

| Tab | Purpose |
| --- | --- |
| **Import** | Drag & drop MCX **Bhavcopy** CSV files (from the MCX website). Files are filed under the trade date *inside* the file and re-imports are skipped. If auto-import is on, files saved to your Downloads folder are imported within seconds (local installs). |
| **Data health** | What is loaded, rejected files, files whose dates do not match their names, rows without trades and thin-volume rows. |
| **Coverage** | A month calendar of which sessions and contracts are loaded. |

Hosted sites also refresh automatically from the data provider every few
hours; signed-in users can press **↻** in the status pill.

How much history unlocks what:

| Trading days | Unlocks |
| --- | --- |
| 1 | Prices, volumes, today's gaps, futures curve |
| 2+ | Day-on-day change, sparklines, trends |
| 6+ | "vs usual" (σ) rankings, gauges, gap history |
| 20+ | Backtest |

---

## 10. Research, reports and sharing

- **Save research** (Compare or Backtest, signed in) stores the exact
  settings and notes. Open **Research** to reopen, rename, edit notes,
  delete — or **Certify on Bitcoin** (see section 12).
- **Share report** builds a one-page research note: findings, key figures,
  the chart, "would trading it have worked?" and caveats. Use **Download
  PDF** (opens your browser's print dialog — choose *Save as PDF*) or
  **Copy link**.

---

## 11. On-chain gold (Web3)

**More → On-chain gold** compares MCX with **tokenized gold** on the
Ethereum blockchain:

- **PAX Gold (PAXG)** by Paxos and **Tether Gold (XAUT)** by Tether — each
  token represents one fine troy ounce of gold.

What you see:

1. **Token cards** — price per token in ₹ and $, the **India parity** per
   10 g (token price ÷ 31.1035 g × 10 × (1 + import duty)), and the number of
   tokens in existence **read directly from the token contract** on
   Ethereum, with a link to Etherscan.
2. **MCX vs on-chain gold, now** — every MCX product against both tokens;
   a positive gap means MCX is dearer.
3. **Gap over the past year** — daily MCX settlement against token parity
   for any product and token, using the import duty in force on each day.
4. **How this is calculated** — all assumptions (GST and local premiums are
   not included; MCX futures also include cost of carry).

This is read-only: no wallet, token or transaction is involved.

---

## 12. Proof of research (Bitcoin timestamps)

Prove that a research note or practice trade **existed at a certain time and
has not changed since** — anchored in the Bitcoin blockchain.

**How it works**
1. **Certify** — closed practice trades are certified automatically; for a
   research note press **Certify on Bitcoin** on the Research page.
2. **Seal** — about every hour, new fingerprints (salted SHA-256 hashes) are
   combined into one Merkle root and sent to the free **OpenTimestamps**
   service. Only that root leaves Auraxis.
3. **Anchor** — within a few hours the root is committed to a Bitcoin block.

**Using it** (**More → Proof of research**)
- **Your proofs** lists each record: *Queued* → *Waiting for Bitcoin* →
  *Anchored in Bitcoin* (with the block number). Click one for details and
  downloads:
  - **Download proof file** (.json) — share this to prove your record,
  - **Stamped document (.txt)** and **Timestamp (.ots)** — upload both at
    [opentimestamps.org](https://opentimestamps.org) to check independently.
- **Verify a proof** (no login needed): choose or paste a proof file. Each
  check is shown with ✓ or ✕: fingerprint, Merkle path, root, timestamp and
  Bitcoin anchoring. Any edit to the record makes it **Not valid**.

---

## 13. Your account, security and wallet

- **Profile** — your name, account details and the optional **Web3 wallet**.
- **Security** — set up **two-factor authentication** with an
  authenticator app (six-digit codes), generate **recovery codes**, and
  **change password and sign out everywhere**. **Recover account** signs you
  in with an unused recovery code if you lose your authenticator.

### Linking a wallet (optional)
1. Install a browser wallet such as **MetaMask**.
2. **Profile → Web3 wallet → Connect wallet**, choose an account.
3. Your wallet asks you to **sign** a "Sign-In with Ethereum" message naming
   this site. Signing is **free**: no transaction, no gas, no access to funds.
4. The linked address appears with a link to Etherscan; **Unlink** any time.

A wallet can be linked to only one Auraxis account, and nothing in Auraxis
requires one.

---

## 14. Learn: methodology, tour and demo

- **Methodology** — every formula, data rule and limitation in detail.
- **Guided tour** — eight steps from "what is the gap?" to "do costs change
  the result?".
- **Present demo** — a full-screen presentation with captions quoting the
  day's numbers. Keys: **→ / Space** next, **←** back, **P** play/pause,
  **Esc** exit.

---

## 15. Live versus settled prices

| | Live | Settled |
| --- | --- | --- |
| **What** | Last traded prices during the session, updated every 30 s | The official daily settlement price |
| **When** | 09:00–23:55 IST, Mon–Fri | After MCX publishes it (after the close) |
| **Where** | Overview, Practice, On-chain "now" | Everywhere, including Compare, Backtest and history |
| **Status** | Provisional — can change all day | Final |

During a session the Overview leads with **live** figures and compares them
with the **last settlement** ("change since 19 Nov close"). Once that day's
settlement is loaded, everything switches to final figures automatically.
Thinly traded contracts may not trade for a while, so each shows its last
trade time.

---

## 16. Glossary

| Term | Meaning |
| --- | --- |
| **MCX** | Multi Commodity Exchange of India. |
| **GOLDM / GOLDTEN / GOLDGUINEA / GOLDPETAL** | MCX gold futures of different lot sizes (100 g, 10 g, 8 g, 1 g). |
| **₹ per 10 g** | The common price scale used everywhere. |
| **Gap** | First product's price minus the second's, per 10 g. |
| **σ (sigma), z-score** | How many standard deviations a gap is from its recent average. |
| **Expiry** | The date a futures contract ends. |
| **Settlement** | The official end-of-day price. |
| **Open interest** | Contracts still open (not yet closed out). |
| **Volume** | Amount traded in the session (shown in g or kg). |
| **bps** | Basis points; 5 bps = 0.05%. |
| **Margin held** | Part of demo money set aside while a practice trade is open (10% of its value). |
| **Cost of carry** | Why later contracts usually cost more (financing and storage). |
| **Tokenized gold** | Blockchain tokens backed by physical gold (PAXG, XAUT). |
| **Parity** | What on-chain gold costs per 10 g landed in India, including import duty. |
| **Merkle root** | One hash that commits to many fingerprints. |
| **OpenTimestamps** | A free public service that anchors hashes in Bitcoin. |
| **Sign-In with Ethereum** | A standard, free wallet signature proving you control an address. |

---

## 17. FAQ and troubleshooting

**The badge says LIVE but the date looks old.**
Live figures are compared with the *last settlement*. Today's settlement
appears after the close; until then changes read "since <date> close".

**"Can't reach the data server" / Offline.**
The backend is restarting or unreachable. Wait a moment and reload. On a
local install, start the backend on port 8010.

**A practice trade was refused.**
MCX is closed, live prices are delayed, a contract has not traded today, you
lack available demo money, or you already hold 20 open trades.

**The σ gauge or backtest is missing.**
Not enough history yet — rankings need 6 trading days and the backtest
about 20.

**My proof still says "Waiting for Bitcoin".**
Normal — Bitcoin anchoring usually takes a few hours. The proof is already
verifiable for its fingerprint and Merkle path.

**"Connect wallet" is missing.**
No wallet extension was detected in this browser. Install one (for example
MetaMask) and reload — or skip it; it is optional.

**Is any of this financial advice?**
No. Auraxis is for research and learning. Demo money has no value and
practice results do not guarantee real-world results.
