# Axis Progress Map

A community-made site for [Axis Robotics](https://axisrobotics.ai/) contributors.

You drop in a public Base wallet address. The site pulls that wallet’s public Axis Hub activity and turns it into one clear progress map — what you submitted, what skills and environments it maps to, how it looks over time, and a card you can download and share.

**Unofficial.** Not affiliated with or endorsed by Axis Robotics.  
**Read-only.** No wallet connect. No private keys. Public data only.

---

## What the site is

Axis Progress Map is a personal progress view for people who contribute on Axis Hub.

Hub already shows your work. This site is for seeing that same public activity as a bigger picture: totals, signed vs unsigned, skills, environments, coverage, history, and a shareable card — without logging in or connecting a wallet.

You only ever enter a public address (`0x…`). Nothing else is asked for.

---

## Opening the site

When you land:

1. A short brand screen loads first.
2. Then a welcome panel explains what this is and who made it.
3. You dismiss it with **Got it, Enter** (or press Enter).

You can open that same welcome again later from **About** in the top nav.

The top bar stays with you on every page: the Axis Progress Map mark, **About**, **HOW** (how the map is built), and — once you’re past the home screen — **NEW WALLET** to start over with a different address.

---

## Home

Home is simple on purpose.

- A short intro to the tool
- One field for your public Base wallet
- A clear enter action

Below that, three steps spell out the idea:

1. **Pull** — your public Hub attempts  
2. **Match** — those tasks to Axis skill / environment info  
3. **Show** — a clear breakdown plus a card  

Paste a valid `0x…` address and go. No account. No Axis login. No wallet popup.

---

## Loading your map

After you submit an address, you move into a preparation screen while the site gathers that wallet’s public Hub history.

You’ll see progress as it works through the public record. First-time wallets can take longer; wallets the site has already seen tend to come back faster.

If something’s off, you can go back with **NEW WALLET** and try another address. When the pull finishes, you land on the full progress map for that wallet.

---

## Your progress map

This is the main report. Top to bottom, it usually includes:

### Overview
High-level numbers for the wallet — trajectories / attempts, signed vs unsigned, unique tasks, scores where available, and how much of the activity could be matched to Axis task info.

### Skill distribution
Which robot skills show up most in your matched tasks. One task can touch more than one skill, so overlap is normal.

### Environment distribution
Where those tasks sit — kitchen, home, office, and similar settings — based on matched Axis task info.

### Data coverage
How much of the Hub activity could be matched to public Axis task metadata. That coverage is what unlocks the richer skill and environment detail.

### How I build this
A plain walkthrough of the approach: pull public Hub activity, match it to Axis task info, split the picture into skills / environments / history, and optionally cross-check Base.

### Base verification
An optional extra look at public on-chain Base records when available. Hub numbers still lead; Base is supporting context, not a replacement.

### Contribution history
Your Hub attempts over time, so you can see pace and streaks instead of only totals.

### Contribution explorer
A searchable list of every public Hub attempt for that wallet — useful when you want the raw line-by-line record behind the charts.

### Share card
At the end you can generate a downloadable PNG of the map.

- Optionally add Hub / X names (labels only — not verified)
- Preview the card
- Download it to post or keep

The card is built from the same public Hub picture you just viewed.

---

## How to use it, start to finish

1. Open the site  
2. Read the welcome, then enter  
3. Paste a public Base wallet (`0x…`)  
4. Wait while public Hub history is pulled  
5. Explore the map — skills, environments, coverage, history, explorer  
6. Generate a share card if you want  
7. Use **NEW WALLET** anytime to look up another address  

That’s the whole product loop.

---

## What this is not

- Not an official Axis Robotics product  
- Not a wallet app — it never connects to your wallet  
- Not asking for keys, seed phrases, or private Hub credentials  
- Not inventing contribution data — it works from public Hub activity and public Axis task info  

If Hub has no public activity for an address, the map will reflect that. If some tasks can’t be matched yet, skill and environment detail may be thinner while the Hub totals still show.

---

## Deploy notes (Vercel)

Production persistence is **Turso / libSQL** (shared durable DB). The app does not use local SQLite on Vercel.

**Required (Production):**
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

**Optional:**
- `BASE_RPC_URL` — Base RPC (defaults to public mainnet if unset)
- `NEXT_PUBLIC_SITE_URL` — canonical site origin for share links

**Do not set in production:**
- `AXIS_USE_DEV_FIXTURE` (fixtures are hard-disabled when `NODE_ENV=production` anyway)

Local development: leave `TURSO_*` unset to use a local file DB under `data/`, or point `TURSO_DATABASE_URL` at Turso / a `file:` URL. See `.env.example`.

---

## Links

- [Axis Robotics](https://axisrobotics.ai/)  
- [Axis Robotics on X](https://x.com/axisrobotics)  
- [Axis Robotics Discord](https://discord.gg/axisrobotics)  

---

## Created by

[@emir_ethh](https://x.com/emir_ethh)
