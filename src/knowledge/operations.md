# Dryad Operational Manual

## Decision Loop (every 24 hours)
1. Check weather — don't schedule work if heavy rain in 48hrs
2. Process new photo submissions from /Dryad/submit portal
3. Query iNaturalist API for observations in parcel bounding box
4. Compute ecosystem health score (0-100, weighted by MNFI priority tiers)
5. Check treasury health (wstETH balance, yield, spending mode)
6. Check DIEM stake (Venice inference credits)
7. If P1 invasives detected → email contractor via AgentMail
8. If milestone threshold crossed → record on DryadMilestones.sol
9. Post summary to logs

## Treasury Model
- Principal target: $27,000 in wstETH on Base
- APR: 3.5% (Lido staking yield)
- Annual yield at target: ~$945
- Split: 60% stETH / 40% USDC (on Aave/Morpho for 3-5% stable APR)
- Annual costs: taxes $270, VPS $58, gas $5, LLC $50, contractors ~$500
- Spending modes:
  - NORMAL: yield covers all costs
  - CONSERVATION: yield below threshold, pause discretionary contractor work
  - CRITICAL: principal declining, alert steward

## Contractor Coordination
- Email via AgentMail (dryad@agentmail.to)
- Work orders: scope, parcel GPS, budget, photo requirements
- Payment: USDC on Base, $50/tx limit, $200/day limit
- Verification: GPS-tagged before/after photos via /Dryad/submit
- 3-point validation: GPS within 50m of parcel, timestamp ≤72hrs, hash integrity
- Seasonal cadence: 1-2 jobs/year during establishment, 1/year once established

## On-Chain Records
- Contract: DryadMilestones.sol (0x7572dcac88720470d8cc827be5b02d474951bc22)
- Types: SiteAssessment, InvasiveRemoval, SoilPrep, NativePlanting, Monitoring
- Each milestone: type, parcel address, description, data hash, timestamp, recorder
- Viewable on BaseScan

## Addresses
- Agent wallet: 0xf2f7527D86e2173c91fF1c10Ede03f6f84510880 (dryadforest.eth)
- USDC (Base): 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
- wstETH (Base): 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452
- DIEM Token: 0xf4d97f2da56e8c3098f3a8d538db630a2606a024
- Uniswap V3 Router: 0x2626664c2603336E57B271c5C0b26F421741e481
- ERC-8004 Registry: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432

## Parcels (parcel numbers 12009482–12009490)
4475, 4481, 4487, 4493, 4501, 4509, 4513, 4521, 4523 — all 25th Street
GPS bounding box: SW 42.3411,-83.1007 / NE 42.3424,-83.0994
Center: 42.34174, -83.10007

## iNaturalist Integration
- Project: inaturalist.org/projects/dryad-25th-street-parcels-mapping
- API: api.inaturalist.org/v1/observations with bounding box filter
- Rate limit: 60 req/min (unauthenticated)
- Cache observations for 24 hours (matches loop interval)

## Email Footer (mandatory on all outgoing)
"This message was sent by Dryad, an autonomous AI agent managing native habitat restoration on vacant lots in Detroit as part of 'The Forest That Owns Itself' project. For questions or concerns, contact Nick George (project steward) at powahgen@gmail.com."
