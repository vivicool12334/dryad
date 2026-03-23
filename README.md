# Dryad — The Forest That Owns Itself

An autonomous AI agent that manages 9 vacant lots on 25th Street in Detroit for native habitat restoration. Dryad monitors biodiversity, coordinates invasive species removal, pays contractors, and records every milestone onchain — funded entirely by DeFi yield.

**Built for [The Synthesis Hackathon](https://synthesis.builders) (March 2026)**

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
│  Decision Loop (every 24 hours):                       │
│  1. Check iNaturalist for on-parcel observations       │
│  2. Detect invasives → email contractor via AgentMail  │
│  3. Review proof-of-work submissions                   │
│  4. Check treasury health (stETH yield, DIEM stake)    │
│  5. Record milestones onchain on Base L2               │
│  6. Evaluate adaptive spending mode                    │
└─────────────────────────────────────────────────────────┘
         │                    │                    │
    Email via            USDC payment         Milestone
    AgentMail            on Base              on Base
```

## Onchain Contracts (Base Mainnet)

| Contract | Address |
|----------|---------|
| DryadMilestones | [`0x7572dcac88720470d8cc827be5b02d474951bc22`](https://basescan.org/address/0x7572dcac88720470d8cc827be5b02d474951bc22) |
| ERC-8004 Identity (#35293) | [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) |
| Agent Wallet | [`dryadforest.eth`](https://app.ens.domains/dryadforest.eth) / [`0xf2f7527D86e2173c91fF1c10Ede03f6f84510880`](https://basescan.org/address/0xf2f7527D86e2173c91fF1c10Ede03f6f84510880) |
| DIEM Token | [`0xf4d97f2da56e8c3098f3a8d538db630a2606a024`](https://basescan.org/address/0xf4d97f2da56e8c3098f3a8d538db630a2606a024) |

## Financial Model

**Annual operating cost:** $645/yr (property taxes $270, VPS $58, DIEM $62, contractors $200, LLC $50, gas $5)

**Self-sustainability target:** $18,429 in stETH at 3.5% APR = $645/yr yield. That's ~7.1 ETH.

**Treasury resilience:** 60% stETH / 40% USDC split. USDC on Aave/Morpho for stable yield. Survives a 50% ETH crash at 2x capitalization.

**Adaptive spending modes:**
- **NORMAL** — all operations active, yield covers costs
- **CONSERVATION** — pause discretionary contractor jobs, maintain monitoring + taxes + VPS
- **CRITICAL** — steward intervention needed

**Total to bootstrap and sustain forever: ~$35K** ($17K setup + $18K treasury)

## Agent Actions

| Action | Description |
|--------|-------------|
| `CHECK_BIODIVERSITY` | Pull iNaturalist observations filtered to parcel GPS bounding box, detect 7 invasive species, compute health score |
| `MANAGE_STETH` | Check wstETH balance, calculate yield projections, enforce yield-only spending |
| `MANAGE_DIEM` | Monitor DIEM stake for Venice AI inference credits |
| `PAY_CONTRACTOR` | USDC payments on Base ($50/tx, $200/day limits) |
| `RECORD_MILESTONE` | Record SiteAssessment, InvasiveRemoval, SoilPrep, NativePlanting, Monitoring onchain |
| `VERIFY_ATTESTATION` | Verify GPS-tagged photo attestations against parcel boundaries |
| `SEND_EMAIL` / `CHECK_EMAIL` | AgentMail integration at dryad@agentmail.to |

## Web Pages

| Path | Description |
|------|-------------|
| `/Dryad/dashboard` | Live dashboard: satellite map, health score, treasury, stress tests, milestones, iNaturalist observations |
| `/Dryad/submit` | Contractor proof-of-work upload + community iNaturalist biodiversity survey |

## Tech Stack

- **[elizaOS](https://elizaos.ai) v1.7.2** — Agent framework
- **[Venice.ai](https://venice.ai)** — LLM inference (GLM 4.7 Flash), DIEM token for self-sustaining credits
- **[Base L2](https://base.org)** — All onchain transactions
- **[Lido](https://lido.fi)** — wstETH for yield-generating treasury
- **[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)** — Onchain agent identity standard
- **[iNaturalist](https://inaturalist.org)** — Biodiversity data (community-sourced, research-grade)
- **[AgentMail](https://agentmail.to)** — Agent email (dryad@agentmail.to)
- **[Mapbox](https://mapbox.com)** — Satellite imagery on dashboard

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

## Bounties

| Bounty | Target |
|--------|--------|
| Venice AI (~$5,750) | Venice inference + DIEM self-management |
| Protocol Labs: Let the Agent Cook ($2,000) | Complete autonomous decision loop + ERC-8004 |
| Protocol Labs: Agents With Receipts ($2,000) | Every action recorded onchain |
| Lido: stETH Agent Treasury ($2,000) | Yield-only spending, split treasury |
| Base: Agent Services ($1,667) | All activity on Base mainnet |
| Octant: Public Goods ($1,000) | Open-source urban ecology |

## License

MIT

## Steward

Nick George — powahgen@gmail.com
