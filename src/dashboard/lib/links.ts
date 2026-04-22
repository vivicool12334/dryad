export const SITE_URL = 'https://dryad.vercel.app';
export const INATURALIST_PROJECT_URL =
  'https://www.inaturalist.org/projects/dryad-25th-street-parcels-mapping';
export const MILESTONES_CONTRACT_ADDRESS = '0x7572dcac88720470d8cc827be5b02d474951bc22';

const BASESCAN_TX_BASE_URL = 'https://basescan.org/tx';
const BASESCAN_ADDRESS_BASE_URL = 'https://basescan.org/address';

export const NAV_LINKS = [
  { href: '/', label: 'Chat' },
  { href: '/Dryad/submit', label: 'Submit Work' },
  { href: '/Dryad/contractors', label: 'Apply' },
  { href: '/Dryad/mock', label: 'Year 3 Mock' },
  { href: INATURALIST_PROJECT_URL, label: 'iNaturalist' },
] as const;

export function toBasescanTxUrl(hash: string): string {
  return `${BASESCAN_TX_BASE_URL}/${hash}`;
}

export function toBasescanAddressUrl(address: string): string {
  return `${BASESCAN_ADDRESS_BASE_URL}/${address}`;
}
