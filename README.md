# Meme Killer

**Paste a Solana mint address. Find out whether this meme coin is a trap — before you buy.**

Meme Killer is an on-chain risk scanner for Solana meme coins. It runs five
scored checks plus two unscored analytical views against live chain data,
applies hard vetoes, and returns a 0–100 risk score with a concrete
position-size recommendation.

> ⚠️ **Not financial advice.** A low score means "no obvious problem found" —
> not "safe". Meme coins going to zero is the norm.

**Every conclusion comes from live on-chain data. There is no mock-data path
anywhere in the product** — no fixtures, no seeded results, no demo mode.
The test suite uses fixtures; the app never does.

---

## Try it

```bash
npm install
cp .env.example .env.local     # add your Helius RPC / API key (see below)
npm run dev                    # → http://127.0.0.1:5273
```

Open the page, connect a Solana wallet (one signature, no transaction, no gas),
and paste a mint address.

```bash
npm test          # 233 tests
npm run typecheck
npm run build
```

**Why a wallet is required:** every scan costs real Helius API credits. To keep
the demo usable for everyone, each wallet is rate-limited to one scan per 60
seconds (deep analysis: one per 5 minutes). Signing is free — it proves you own
the address, sends no transaction, and costs no gas.

### Data source configuration

The app **only uses real data sources**, so a working RPC endpoint is required.
The public `api.mainnet-beta.solana.com` is heavily rate-limited and will fail —
a single scan issues a dozen-plus RPC calls. **Helius is recommended.**

```bash
# .env.local
SOLANA_RPC_URL="https://mainnet.helius-rpc.com/?api-key=YOUR_KEY"
HELIUS_API_KEY=""     # optional: skip if the RPC URL already carries the key
```

No other keys needed — DexScreener and RugCheck are free and public.

---

## What it checks

Five scored dimensions plus two unscored views. Weights reflect how often each
mechanism actually kills a token — measured against real tokens, not guessed.

| Dimension | Weight | What it looks at |
|---|---|---|
| **Contract safety** | 30% | Mint / freeze authority, Token-2022 extensions (transfer hooks, permanent delegate), transfer tax, LP burned or locked |
| **Liquidity & flow** | 25% | Bonding-curve depth and graduation, wash trading, honeypot patterns, sell pressure |
| **Holder concentration** | 20% | Top-10 share **after excluding pools, burn addresses and time locks** |
| **Developer history** | 15% | How many tokens the creator launched, whether they've exited their own position |
| **Social signal** | 10% | Wash-trade detection (**no data source connected — always "not collected", never scored**) |
| **Diamond hands** | 0% | Who is actually holding, verified against full holder enumeration |
| **Sell pressure** | 0% | Per-wallet cost basis reconstructed from trades → likely sellers |

Diamond hands and sell pressure carry **zero weight on purpose**: they describe
*who holds the supply*, not a direction of risk. Scoring "hasn't sold yet" as a
positive would systematically favour brand-new tokens — where nobody has had a
chance to sell. They are shown as analysis, not folded into the score.

### Hard vetoes

Any one of these forces the score to 100, so the number can never contradict
the conclusion:

| Dimension | Veto condition |
|---|---|
| Contract safety | Mint / freeze authority not renounced; Token-2022 with `TransferHook` or `PermanentDelegate` |
| Liquidity | Buy pressure one-sided while sell count < 5% (honeypot pattern) |
| Holder concentration | Top-10 > 40% of circulating supply after exclusions |
| Developer history | Creator has fully exited |
| Contract safety | LP **verified unlocked and unburned**, held by a single address (rug-pull ready) |

**Risk bands:** `< 25` low · `25–45` medium · `45–65` high · `> 65` extreme.

---

## What makes it different

Most meme-coin scanners count things. The hard part is *not being confidently
wrong*. Four decisions shaped this build:

**1. "Unknown" is a first-class value — never silently treated as safe.**
If a check can't run, the report says so and drops it from the score. Coverage
below 40% voids the score entirely rather than producing a confident-looking
number from thin data. There is no code path that fills a missing value with an
optimistic default.

**2. Every number can be verified on-chain by hand.**
The report's numbers are constructed so a reader can re-add them: if it says
Top-10 is 42%, the table below it lists the ten positions that sum to 42%.
Real signatures, timestamps and wallets are attached to the large-sell evidence,
so a claim like "largest single sell 2.028 SOL" is clickable, not decorative.

**3. Pool addresses are *derived*, never regex-guessed.**
The single largest source of false positives in this class of tool is
misidentifying a pool. Guessing by address pattern (or by "who is selling")
either counts the liquidity pool as a whale — inflating concentration — or
erases the developer's own supply. Pool ownership is resolved by reading which
program actually controls the account.

**4. The caliber matters more than the threshold.**
Recalibrating against 44 real tokens showed the thresholds were fine — the
*measurement* broke down on small samples. On tokens with fewer than 20 holders,
top-10 concentration reads ~100% of circulating supply because there is nothing
else to hold. After fixing the caliber, false vetoes went from 12/21 to 0/21.

---

## Architecture

```
Providers (raw, per-source)  →  Normalized data contract  →  Pure analyzers  →  Engine  →  Report
   Solana RPC                     core/types.ts               core/analyzers/     engine.ts
   Helius DAS + Enhanced API
   DexScreener
   RugCheck
```

Analyzers depend **only** on the normalized contract — they have no idea where
data came from. Adding a data source means adding one provider; analysis logic
does not change. Every field carries provenance (`onchain` / `dexscreener` /
`derived` / `uncollected`), and the report surfaces it per field.

Graceful degradation is built in: lose Helius and two dimensions are marked
"not collected" (coverage drops to 65%) while the rest still work. Lose
RugCheck and only LP status and holder count degrade — to "unknown", with a
warning, never to "safe".

### Tech

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind 4 · Solana Web3.js ·
Wallet Adapter · better-sqlite3. Charts are hand-written SVG — no chart library.

**Bilingual (English / Chinese)** with a top-bar toggle, following the browser
language on first visit. This required conclusions to be structured data
(`{ id, params }`) rather than formatted strings, so a missing translation is a
**compile error** instead of silently rendering the wrong language.

### Privacy

Analytics is stored locally in SQLite and never sent to a third party.
Wallet addresses are stored as HMAC-SHA256 hashes, not plaintext — enough to
count unique users and retention, not enough to see who is watching which token.
Token addresses are stored as-is, since they're public on-chain anyway.
Inspect it yourself with `npm run stats`.

---

## Documentation

| Document | Contents |
|---|---|
| [data-sources.md](docs/data-sources.md) | What each source provides, dimension coverage, degradation behavior |
| [design-decisions.md](docs/design-decisions.md) | The 23 engineering decisions, each tied to a specific real misjudgment |
| [architecture.md](docs/architecture.md) | Module layout, responsibilities, API contract |
| [known-limitations.md](docs/known-limitations.md) | What it deliberately cannot do, and why |
| [deployment.md](docs/deployment.md) | Self-hosting (Docker), Fly.io, and why serverless platforms don't fit |
| [roadmap.md](docs/roadmap.md) | What's next |

> These are written in Chinese for the maintainer. The short version of
> *known limitations* is below.

---

## Known limitations (summary)

The report itself labels every field **on-chain / DexScreener / derived / not
collected**. Please treat derived values differently from on-chain facts.

- **Social signal has no data source.** Helius doesn't provide it and it isn't
  on-chain. It is permanently "not collected" and never scored — we do not
  substitute a proxy value and pretend it was checked.
- **Full holder enumeration ≠ all holders.** It enumerates token accounts.
  Emptied accounts still count toward the account total (hence two distinct
  numbers: accounts vs. holders with a balance). Sybil / split wallets cannot be
  detected — that needs each account's earliest funding source.
- **Only the top 20 holders get custody analysis.** Deciding whether a position
  is time-locked or multisig requires walking each account's controlling
  program. Holder #21 onward is classified by address only.
- **No historical rug rate.** That needs price and liquidity history across a
  creator's past tokens. The tool reports how many tokens were launched and
  marks all outcomes **unverified** — it never claims a clean history.
- **LP lock/burn status comes from RugCheck, not RPC.** RPC cannot see who holds
  LP. If RugCheck is unreachable or hasn't indexed the pool, the status is
  "unknown" with a warning — never assumed safe or unsafe.
- **Liquidity-pull detection is not implemented.** Detecting that funds were
  drained requires comparing two snapshots over time; a single scan only sees
  current pool depth.
- **Sniper share is a lower bound.** It intersects the earliest 25 trades'
  fee payers with the current top 20 — a window, not full history.
- **Buy/sell counts come from the most recent 100 trades**, not lifetime
  aggregates.
- **Custody programs use a verified allowlist** (Jupiter Lock, Squads multisig).
  Unlisted programs are neither labeled nor excluded — only counted in warnings.

---

## Disclaimer

Meme Killer is a research and educational tool. It is **not investment advice**
and it cannot guarantee that a token is safe. A high risk score is a strong
signal; a low one only means the checks found nothing. **Do your own research.**

**Cross-verification:** RugCheck · DexScreener · Solscan · Bubblemaps.
