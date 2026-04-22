/**
 * Ethereum Attestation Service (EAS) integration for Dryad.
 *
 * Mints onchain attestations on Base mainnet when contractor work
 * passes vision verification. These attestations are portable,
 * verifiable proof-of-impact that the wider ReFi ecosystem recognizes.
 *
 * EAS contracts (predeploys on Base):
 *   SchemaRegistry: 0x4200000000000000000000000000000000000020
 *   EAS:            0x4200000000000000000000000000000000000021
 *
 * Flow:
 *   1. On first run, register Dryad's work attestation schema (one-time)
 *   2. After each vision-approved submission, mint an attestation
 *   3. Store the attestation UID on the submission record
 */
import { logger } from '@elizaos/core';
import {
  createPublicClient,
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, DEMO_MODE } from '../config/constants.ts';

// ── EAS Contract Addresses (predeploys on Base & Base Sepolia) ──
const EAS_ADDRESS = '0x4200000000000000000000000000000000000021' as `0x${string}`;
const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020' as `0x${string}`;

// ── Dryad Work Attestation Schema ──
// This describes what data each attestation contains.
// Format: "address contractor, string workType, string parcelAddress, bytes32 photoHash, uint8 visionScore, uint64 timestamp, string description"
const SCHEMA_STRING =
  'address contractor,string workType,string parcelAddress,bytes32 photoHash,uint8 visionScore,uint64 timestamp,string description';

// ── Dryad iNaturalist Observation Attestation Schema ──
const OBSERVATION_SCHEMA_STRING =
  'string observerName,string speciesName,string commonName,string qualityGrade,uint64 observationId,string parcelAddress,string location,uint64 observedAt,bool isInvasive';

// Schema UIDs are stored after registration (or loaded from env if already registered)
let cachedSchemaUid: Hex | null = null;
let cachedObservationSchemaUid: Hex | null = null;

// ── ABI fragments we need ──
const SCHEMA_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'schema', type: 'string' },
      { name: 'resolver', type: 'address' },
      { name: 'revocable', type: 'bool' },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'getSchema',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'uid', type: 'bytes32' },
          { name: 'resolver', type: 'address' },
          { name: 'revocable', type: 'bool' },
          { name: 'schema', type: 'string' },
        ],
      },
    ],
  },
] as const;

const EAS_ABI = [
  {
    name: 'attest',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'schema', type: 'bytes32' },
          {
            name: 'data',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'expirationTime', type: 'uint64' },
              { name: 'revocable', type: 'bool' },
              { name: 'refUID', type: 'bytes32' },
              { name: 'data', type: 'bytes' },
              { name: 'value', type: 'uint256' },
            ],
          },
        ],
      },
    ],
    outputs: [{ name: '', type: 'bytes32' }],
  },
] as const;

// ── Helper: get viem clients ──
function getClients() {
  const pk = process.env.EVM_PRIVATE_KEY;
  if (!pk) throw new Error('EVM_PRIVATE_KEY not set');

  const chain = CHAIN.USE_TESTNET ? baseSepolia : base;
  const transport = CHAIN.RPC_URL ? http(CHAIN.RPC_URL) : http();

  const account = privateKeyToAccount(pk as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  return { publicClient, walletClient, account };
}

async function ensureSufficientGas(): Promise<void> {
  const { publicClient, account } = getClients();
  const balance = await publicClient.getBalance({ address: account.address });
  const MIN_BALANCE = 1_000_000_000_000n; // 0.000001 ETH (~enough for a few txs on Base)
  if (balance < MIN_BALANCE) {
    throw new Error(`Insufficient gas balance: ${balance} wei. Minimum required: ${MIN_BALANCE} wei.`);
  }
}

/**
 * Compute the schema UID deterministically (same way EAS does).
 * UID = keccak256(schema + resolver + revocable)
 */
function computeSchemaUid(schema: string, resolver: `0x${string}`, revocable: boolean): Hex {
  return keccak256(
    encodePacked(
      ['string', 'address', 'bool'],
      [schema, resolver, revocable]
    )
  );
}

/**
 * Get or register Dryad's attestation schema on Base.
 * Returns the schema UID. Idempotent - won't re-register if it already exists.
 */
export async function getOrRegisterSchema(): Promise<Hex> {
  // Check env override first (if schema was already registered)
  if (process.env.EAS_SCHEMA_UID) {
    cachedSchemaUid = process.env.EAS_SCHEMA_UID as Hex;
    return cachedSchemaUid;
  }

  if (cachedSchemaUid) return cachedSchemaUid;

  const { publicClient, walletClient } = getClients();
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

  // Compute expected UID
  const expectedUid = computeSchemaUid(SCHEMA_STRING, ZERO_ADDRESS, true);

  // Check if already registered
  try {
    const existing = await publicClient.readContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: SCHEMA_REGISTRY_ABI,
      functionName: 'getSchema',
      args: [expectedUid],
    });

    if (existing && existing.uid !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      cachedSchemaUid = expectedUid;
      logger.info(`[EAS] Schema already registered: ${expectedUid}`);
      return expectedUid;
    }
  } catch {
    // Schema doesn't exist yet - that's fine, we'll register it
  }

  // Register the schema
  logger.info(`[EAS] Registering schema on ${CHAIN.USE_TESTNET ? 'Base Sepolia' : 'Base mainnet'}...`);
  const hash = await walletClient.writeContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'register',
    args: [SCHEMA_STRING, ZERO_ADDRESS, true],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  logger.info(`[EAS] Schema registered in tx ${hash} (block ${receipt.blockNumber})`);

  cachedSchemaUid = expectedUid;
  return expectedUid;
}

/**
 * Mint an onchain attestation for a vision-approved submission.
 */
export async function attestWorkSubmission(params: {
  contractorAddress: `0x${string}`;
  workType: string;
  parcelAddress: string;
  photoHash: string; // 0x-prefixed hex, keccak256 of the photo
  visionScore: number; // 0-100 integer
  timestamp: number; // unix seconds
  description: string;
}): Promise<{ uid: Hex; txHash: Hex }> {
  const schemaUid = await getOrRegisterSchema();
  const { publicClient, walletClient } = getClients();

  // Encode the attestation data according to our schema
  const encodedData = encodeAbiParameters(
    parseAbiParameters('address contractor, string workType, string parcelAddress, bytes32 photoHash, uint8 visionScore, uint64 timestamp, string description'),
    [
      params.contractorAddress,
      params.workType,
      params.parcelAddress,
      params.photoHash as Hex,
      params.visionScore,
      BigInt(params.timestamp),
      params.description,
    ]
  );

  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

  await ensureSufficientGas();

  const hash = await walletClient.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: 'attest',
    gas: 500_000n,
    args: [
      {
        schema: schemaUid,
        data: {
          recipient: params.contractorAddress,
          expirationTime: 0n, // never expires
          revocable: true,
          refUID: ZERO_BYTES32,
          data: encodedData,
          value: 0n,
        },
      },
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

  // Extract the attestation UID from logs
  // The EAS contract emits Attested(address indexed recipient, address indexed attester, bytes32 uid, bytes32 indexed schemaUID)
  const attestedTopic = keccak256(
    new TextEncoder().encode('Attested(address,address,bytes32,bytes32)')
  );

  let uid: Hex = ZERO_BYTES32;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === EAS_ADDRESS.toLowerCase() && log.topics[0] === attestedTopic) {
      // uid is in the non-indexed data field
      uid = (log.data.slice(0, 66)) as Hex; // first 32 bytes of data
      break;
    }
  }

  logger.info(`[EAS] Attestation minted: uid=${uid} tx=${hash}`);
  return { uid, txHash: hash };
}

/**
 * Get the EAS scan URL for an attestation.
 */
export function getAttestationUrl(uid: Hex): string {
  const base = CHAIN.USE_TESTNET
    ? 'https://base-sepolia.easscan.org'
    : 'https://base.easscan.org';
  return `${base}/attestation/view/${uid}`;
}

// ═══════════════════════════════════════════════════════════
// iNaturalist Observation Attestations
// ═══════════════════════════════════════════════════════════

/**
 * Get or register the iNaturalist observation attestation schema.
 */
export async function getOrRegisterObservationSchema(): Promise<Hex> {
  if (process.env.EAS_OBSERVATION_SCHEMA_UID) {
    cachedObservationSchemaUid = process.env.EAS_OBSERVATION_SCHEMA_UID as Hex;
    return cachedObservationSchemaUid;
  }

  if (cachedObservationSchemaUid) return cachedObservationSchemaUid;

  const { publicClient, walletClient } = getClients();
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`;

  const expectedUid = computeSchemaUid(OBSERVATION_SCHEMA_STRING, ZERO_ADDRESS, true);

  try {
    const existing = await publicClient.readContract({
      address: SCHEMA_REGISTRY_ADDRESS,
      abi: SCHEMA_REGISTRY_ABI,
      functionName: 'getSchema',
      args: [expectedUid],
    });

    if (existing && existing.uid !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      cachedObservationSchemaUid = expectedUid;
      logger.info(`[EAS] Observation schema already registered: ${expectedUid}`);
      return expectedUid;
    }
  } catch {
    // Schema doesn't exist yet
  }

  logger.info(`[EAS] Registering observation schema on ${CHAIN.USE_TESTNET ? 'Base Sepolia' : 'Base mainnet'}...`);
  const hash = await walletClient.writeContract({
    address: SCHEMA_REGISTRY_ADDRESS,
    abi: SCHEMA_REGISTRY_ABI,
    functionName: 'register',
    args: [OBSERVATION_SCHEMA_STRING, ZERO_ADDRESS, true],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  logger.info(`[EAS] Observation schema registered in tx ${hash} (block ${receipt.blockNumber})`);

  cachedObservationSchemaUid = expectedUid;
  return expectedUid;
}

/**
 * Mint an onchain attestation for an iNaturalist observation.
 */
export async function attestObservation(params: {
  observerName: string;
  speciesName: string;
  commonName: string;
  qualityGrade: string; // 'research', 'needs_id', 'casual'
  observationId: number;
  parcelAddress: string;
  location: string; // "lat,lng"
  observedAt: number; // unix seconds
  isInvasive: boolean;
}): Promise<{ uid: Hex; txHash: Hex }> {
  const schemaUid = await getOrRegisterObservationSchema();
  const { publicClient, walletClient, account } = getClients();

  const encodedData = encodeAbiParameters(
    parseAbiParameters('string observerName, string speciesName, string commonName, string qualityGrade, uint64 observationId, string parcelAddress, string location, uint64 observedAt, bool isInvasive'),
    [
      params.observerName,
      params.speciesName,
      params.commonName,
      params.qualityGrade,
      BigInt(params.observationId),
      params.parcelAddress,
      params.location,
      BigInt(params.observedAt),
      params.isInvasive,
    ]
  );

  const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex;

  await ensureSufficientGas();

  const hash = await walletClient.writeContract({
    address: EAS_ADDRESS,
    abi: EAS_ABI,
    functionName: 'attest',
    gas: 500_000n,
    args: [
      {
        schema: schemaUid,
        data: {
          recipient: account.address, // Dryad is the recipient (community observations)
          expirationTime: 0n,
          revocable: true,
          refUID: ZERO_BYTES32,
          data: encodedData,
          value: 0n,
        },
      },
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });

  const attestedTopic = keccak256(
    new TextEncoder().encode('Attested(address,address,bytes32,bytes32)')
  );

  let uid: Hex = ZERO_BYTES32;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === EAS_ADDRESS.toLowerCase() && log.topics[0] === attestedTopic) {
      uid = (log.data.slice(0, 66)) as Hex;
      break;
    }
  }

  logger.info(`[EAS] Observation attested: uid=${uid} tx=${hash} species=${params.speciesName}`);
  return { uid, txHash: hash };
}
