# Auraxis — update (20–21 Nov 2026)

What's new in this fork ([sharmaronit/Auraxis](https://github.com/sharmaronit/Auraxis),
branch **`redesign/graphite`**) compared with
[WhiteGod0227/Auraxis](https://github.com/WhiteGod0227/Auraxis) `main`.

**12 commits · 87 files · about 17,800 lines added**

| | Link |
| --- | --- |
| Live app | https://auraxis-ten.vercel.app |
| Backend health | https://backend-production-f2e6a9f9.up.railway.app/health |
| User guide | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |
| Web3 and blockchain guide | [docs/WEB3.md](docs/WEB3.md) |

---

## Highlights

1. **Live MCX prices** every 30 seconds during market hours (Upstox API),
   clearly labelled *Live*, *Closed* or *Settled*.
2. **Studio redesign**: top navigation, a lean Overview, light and dark themes,
   and a split-screen login.
3. **Practice trading with demo money**: no risk, with achievements and an
   opt-in leaderboard.
4. **Web3 and blockchain** in five optional parts: on-chain gold, Bitcoin
   proofs, wallet link, soulbound badges and on-chain proof anchors.
5. **Deployed**: frontend on Vercel, backend on Railway with a persistent
   volume.

---

## 1. Live market data

- An Upstox connector imports daily history for all four gold contracts
  (GOLDM, GOLDTEN, GOLDGUINEA, GOLDPETAL) and refreshes it on a schedule.
- During MCX hours (09:00–23:55 IST) the backend polls live prices every 30
  seconds. The dashboard ranks today's gaps provisionally, and settled data
  takes over once the session's settlement is loaded.
- MCX Bhavcopy CSVs stay the authoritative source: API rows never overwrite
  imported Bhavcopy rows.

Code: `backend/app/data/live.py`, `backend/app/data/upstox.py`,
`backend/app/api/live.py`, `frontend/src/lib/live.ts`.

## 2. Redesign (UI/UX)

- **Top navigation** with search (`/`), a live-status pill, theme toggle and
  account menu, replacing the sidebar.
- **Overview**: a product picker with a stats strip, a price chart with volume,
  a **Pair check** in plain English ("Below usual: 1.4σ below its 10-session
  average"), all comparisons with sparklines, an exact gap-trend chart with a
  ₹ axis and typical-range band, and a "What stands out" summary.
- **Login**: split screen with a brand panel (live prices and what Auraxis
  does), a compact form, and an explore-as-guest button. `?mode=signup` opens
  sign-up directly.
- **Phones**: sticky price bar, one-row chart toolbar, and card rows instead of
  squeezed tables.
- **Guests** see a dismissible welcome strip.
- **Fixes**: invisible sparklines, cards that could stay hidden when the
  scroll animation didn't fire, a misleading error on Methodology, and a
  styled 404 page.

## 3. Practice trading (demo money)

- Every user starts with ₹10,00,000 of demo money. They can trade a single
  product or a pair gap, with a trading cost of 5 basis points per side.
- Includes open P&L, history, five achievements, a weekly summary and an
  opt-in leaderboard (display name only).
- Demo money has no cash value and can never be tokenized, traded or
  transferred.

Code: `backend/app/api/practice.py`, `frontend/src/pages/PracticePage.tsx`.

## 4. Web3 and blockchain

All parts are optional and switch off cleanly. Market data, demo money and
personal data never go on-chain. Full details: [docs/WEB3.md](docs/WEB3.md).

| Feature | Chain | What it does |
| --- | --- | --- |
| On-chain gold | Ethereum (read-only) | Compares MCX with PAXG and XAUT at India parity (incl. import duty); supply read from the ERC-20 contracts |
| Proof of research | Bitcoin via OpenTimestamps | Salted fingerprints → Merkle root → Bitcoin timestamp; anyone can verify a proof file |
| Wallet link | Off-chain signature | Sign-In with Ethereum (EIP-4361): free, no transaction |
| Soulbound badges | Base Sepolia (testnet) | Earned achievements minted as non-transferable ERC-721/ERC-5192 NFTs; the server pays the test gas |
| Proof anchors | Base Sepolia (testnet) | Each proof root is also written on-chain within about a minute |

- Contract (verified): [`0x7256a51Ba02FE20Bbca1Df2FA96322B5a794f884`](https://sepolia.basescan.org/address/0x7256a51Ba02FE20Bbca1Df2FA96322B5a794f884)
- Tested on the real test network: a badge mint (token #1) and a proof-root
  anchor (block 61,377,855), both verified.
- Transactions are signed by our own small EVM implementation (RLP, EIP-1559,
  RFC 6979), tested byte for byte against `eth-account`.

## 5. Deployment

- **Frontend**: Vercel at https://auraxis-ten.vercel.app. `vercel.json`
  rewrites `/api/*` and `/health` to the backend, so the app uses one origin.
- **Backend**: Railway with a `/data` volume for every SQLite database and the
  cache. Secrets (Upstox token, Web3 signer key) live only in Railway's
  encrypted variables and never in git.

---

## Quality checks (21 Nov)

| Check | Result |
| --- | --- |
| Backend tests | 372 passed |
| Frontend tests | 65 passed; typecheck, lint and build clean |
| Production smoke test | All 21 pages load as a guest, with no errors or failed requests |
| Login journey (real browser) | 10/10: sign-up, wrong password, login with return-to, guest strip |
| Secret scan of the full git history | No tokens or keys found |

---

## Known gaps

- **20 Nov settlement**: not loaded yet. Upstox hadn't published the 20 Nov
  daily candle when checked (00:10 IST, 21 Nov). The backend picks it up on
  its next scheduled refresh (every 6 hours) once it's available. Until then
  the app shows 20 Nov's last traded prices, marked as provisional. Uploading
  the official MCX Bhavcopy on the **Data** page also loads it immediately.
- **Data admins**: `DATA_ADMIN_EMAILS` should be set in production so only
  admins can import or refresh market data.
- **Web3 writes are testnet-only** by design.

## Merging into WhiteGod0227/Auraxis

This branch is based on `5ffdccb`. WhiteGod0227/Auraxis `main` has 6 newer
deployment commits (15 Nov: Railway frontend proxy, backend DNS refresh,
same-origin analytics). The two setups deploy the frontend differently
(Railway proxy vs Vercel), so expect conflicts in deployment config and docs
when merging. The application code is otherwise independent.

## How to run locally

Follow [README.md](README.md) → *Quick start (Windows PowerShell)*: Python
3.12+ and Node 22+, backend on port 8010, frontend on port 5180. Optional
settings (Upstox token, Web3 contract and key) are listed in
`backend/.env.example`.
