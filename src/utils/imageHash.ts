/**
 * Compute keccak256 hash of image file content.
 * Returns hash as hex string with '0x' prefix for blockchain compatibility.
 */

import { keccak256, toHex } from 'viem';

export function computeImageHash(buffer: Buffer): string {
  return keccak256(toHex(buffer));
}
