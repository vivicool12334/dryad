# Dryad — The Forest That Owns Itself

An autonomous AI agent that manages 9 vacant lots on 25th Street in Detroit for native habitat restoration. Dryad monitors biodiversity, coordinates invasive species removal, pays contractors, and records every milestone onchain — funded entirely by DeFi yield.

**Live at [dryad.land](https://dryad.land)** · **Dashboard at [dashboard.dryad.land](https://dashboard.dryad.land/Dryad/dashboard)**

Originally built for [The Synthesis Hackathon](https://synthesis.builders) (March 2026). Now a live, continuously running agent.

## How It Works

```
Community volunteers photograph plants    Contractors complete removal work
via iNaturalist app on the lots           and submit GPS-tagged proof photos
         │                                           │
         ▼                                           ▼
   iNaturalist API ──────────────────────►  /Dryad/submit portal
   (bounding box filter)                    (GPS verified to parcels)
         │                                           │
         ▼                                           ▼
┌─────────────────────────────────────────────────────────┐
│                    DRYAD AGENT                          │
│  elizaOS v1.7.2 + Venice.ai (GLM 4.7 Flash)           │
│                                                         │
│  Decision Loop (configurable — 24h prod, 2min demo):   │
│  1. Check iNaturalist for on-parcel observations       │
│  2. Detect invasives → email contractor via AgentMail  │
│  3. Review proof-of-work submissions                   │
│  4. Mint EAS attestations for verified work            │
│  5. Check treasury health (USDC yield via Aave/Morpho) │
│  6. Record milestones onchain on Base L2               │
│  7. Evaluate adaptive spending mode                    │
│  8. Post to Twitter/X from curated tweet queue         │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
    Email via            USDC payment         Milestone
    AgentMail            on Base              on Base
```

## Onchain Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| DryadMilestones | [`0x7572dcac88720470d8cc827be5b02d474951bc22`](https://basescan.org/address/0x7572dcac88720470d8cc827be5b02d474951bc22) |
| EAS (Attestations) | [`0x4200000000000000000000000000000000000021`](https://base.easscan.org/address/0xf2f7527D86e2173c91fF1c10Ede03f6f84510880) |
| EAS Schema Registry | [`0x4200000000000000000000000000000000000020`](https://base.easscan.org) |
| ERC-8004 Identity (#35293) | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |
| Agent Wallet | [`dryadforest.eth`](https://app.ens.domains/dryadforest.eth) / [`0xf2f7527D86e2173c91fF1c10Ede03f6f84510880`](https://basescan.org/address/0xf2f7527D86e2173c91fF1c10Ede03f6f84510880) |
| DIEM Token | [`0xf4d97f2da56e8c3098f3a8d538db630a2606a024`](https://basescan.org/address/0xf4d97f2da56e8c3098f3a8d538db630a2606a024) |

## Financial Model

**Annual operating cost (Year 3+):** $945/yr (property taxes $270, VPS $58, DIEM $62, contractors $500, LLC $50, gas $5)

**Self-sustainability target:** $23,625 in USDC at ~4% APY = $945/yr yield. DeFi yield via Morpho vaults and Aave V3 on Base. No ETH price risk.

**Current treasury:** ~$122 (USDC deployed in Aave V3 + wallet ETH). The agent actively monitors yield rates and rebalances between Morpho and Aave V3 to maximize APY.

**Adaptive spending modes:**
- **NORMAL** — all operations active, yield covers costs
- **CONSERVATION** — pause discretionary contractor jobs, maintain monitoring + taxes + VPS
- **CRITICAL** — steward intervention needed (current mode — treasury below sustainability target)

**Total funding needed: ~$41K** ($13.5K setup + $2.9K years 1-2 + $23.6K treasury + $1K buffer)

## Agent Actions

| Action | Description |
|--------|-------------|
| `CHECK_BIODIVERSITY` | Pull iNaturalist observations filtered to parcel GPS bounding box, detect 7 invasive species, compute health score |
| `MANAGE_STETH` | Check wstETH balance, calculate yield projections, enforce yield-only spending (legacy — treasury is now USDC-first) |
| `DEFI_YIELD` | Monitor Aave V3 and Morpho vault APYs, deploy/withdraw USDC, rebalance when spread exceeds threshold |
| `MANAGE_DIEM` | Monitor DIEM stake for Venice AI inference credits |
| `PAY_CONTRACTOR` | USDC payments on Base ($50/tx, $200/day limits) |
| `RECORD_MILESTONE` | Record SiteAssessment, InvasiveRemoval, SoilPrep, NativePlanting, Monitoring onchain |
| `VERIFY_ATTESTATION` | Verify GPS-tagged photo attestations against parcel boundaries |
| `ATTEST_WORK` | Mint EAS attestation on Base for verified proof-of-work (contractor, work type, parcel, photo hash, vision score) |
| `ATTEST_OBSERVATION` | Mint EAS attestation for research-grade iNaturalist observations (species, observer, GPS, quality grade) |
| `SEND_EMAIL` / `CHECK_EMAIL` | AgentMail integration at dryad@agentmail.to |
| `POST_TWEET` | Post to Twitter/X from a curated editorial queue (`data/tweet-queue.json`) |

## Web Pages

The static marketing site is served from Vercel at [dryad.land](https://dryad.land). The agent's API and dashboard run on a Hetzner VPS at [dashboard.dryad.land](https://dashboard.dryad.land).

| Path | Host | Description |
|------|------|-------------|
| `/` | dryad.land | Public site: problem statement, architecture, parcels, financials, chat widget |
| `/docs.html` | dryad.land | Extended documentation and technical details |
| `/impact.html` | dryad.land | Impact projections and ecological analysis |
| `/Dryad/dashboard` | dashboard.dryad.land | Live dashboard: Leaflet map, health score, treasury, stress tests, milestones, iNaturalist observations |
| `/Dryad/submit` | dashboard.dryad.land | Contractor proof-of-work upload + community biodiversity survey |
| `/Dryad/contractors` | dashboard.dryad.land | Contractor application portal |
| `/Dryad/api/*` | dashboard.dryad.land | REST API: treasury, health-score, milestones, submissions |

## Repo Notes

- `site/` is the production web root for the static site. Vercel deploys from this directory via `deploy.py` (uses GitHub API to push to the `origin` remote).
- `data/tweet-queue.json` is intentionally tracked. It is curated editorial content, not disposable runtime state.
- `dryad-homepage.html` is a legacy snapshot and is intentionally left untracked. The active public site lives under `site/`.
- The agent runs on a Hetzner VPS with Caddy as a reverse proxy (`dashboard.dryad.land` → `localhost:3000`).

## Tech Stack

- **[elizaOS](https://elizaos.ai) v1.7.2** — Agent framework
- **[Venice.ai](https://venice.ai)** — LLM inference (GLM 4.7 Flash), DIEM token for self-sustaining credits
- **[Base L2](https://base.org)** — All onchain transactions
- **[Aave V3](https://aave.com) / [Morpho](https://morpho.org)** — USDC yield strategies (treasury)
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Onchain agent identity standard
- **[iNaturalist](https://inaturalist.org)** — Biodiversity data (community-sourced, research-grade)
- **[EAS](https://attest.org)** — Ethereum Attestation Service for onchain work attestations on Base
- **[AgentMail](https://agentmail.to)** — Agent email (dryad@agentmail.to)
- **[Leaflet](https://leafletjs.com)** — Interactive maps on dashboard
- **[Twitter/X API v2](https://developer.x.com)** — Automated posting from curated tweet queue

## Parcels

9 vacant lots on 25th Street between Ash and Beech, Detroit, MI (each 30x110 ft, 0.68 acres total):
4475, 4481, 4487, 4493, 4501, 4509, 4513, 4521, 4523

GPS bounding box: SW 42.3411,-83.1007 / NE 42.3424,-83.0994

## iNaturalist Project

[Dryad 25th Street Parcels Mapping](https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping)

## Setup

```bash
# Clone and install
git clone https://github.com/vivicool12334/dryad.git
cd dryad
bun install

# Configure .env (copy from .env.example and add your keys)
cp .env.example .env
# Required: VENICE_API_KEY, EVM_PRIVATE_KEY, AGENTMAIL_API_KEY

# Build and start
bun run build
elizaos start
```

## Invasive Species Watchlist

| Species | Scientific Name | Threat |
|---------|----------------|--------|
| Tree of Heaven | *Ailanthus altissima* | Aggressive colonizer, allelopathic |
| Amur Honeysuckle | *Lonicera maackii* | Outcompetes native understory |
| Purple Loosestrife | *Lythrum salicaria* | Wetland invader |
| Common Reed | *Phragmites australis* | Monoculture former |
| Garlic Mustard | *Alliaria petiolata* | Disrupts mycorrhizal networks |
| Japanese Knotweed | *Reynoutria japonica* | Structural damage, near-impossible to eradicate |
| Common Buckthorn | *Rhamnus cathartica* | Alters soil nitrogen cycles |

## License

MIT

## Steward

Nick George — [@0xnock](https://x.com/0xnock)
