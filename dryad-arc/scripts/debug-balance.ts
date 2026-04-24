import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider('https://rpc.testnet.arc.network')
const addr = '0x1dD8fA0a0d73c7Ed8473E8F45bb76D1eDA695065'
const USDC = '0x3600000000000000000000000000000000000000'
const USYC = '0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C'

// Test 1: raw eth_call for USDC balance
const sel = '0x70a08231'
const padded = addr.toLowerCase().replace('0x', '').padStart(64, '0')

console.log('Testing raw eth_call for USDC balance...')
try {
  const result = await provider.call({ to: USDC, data: sel + padded })
  console.log('raw result:', result)
  console.log('parsed:', Number(BigInt(result)) / 1e6, 'USDC')
} catch (e: any) {
  console.error('eth_call failed:', e.message)
}

// Test 2: native Arc balance (18 decimals)
console.log('\nTesting native Arc USDC balance...')
try {
  const native = await provider.getBalance(addr)
  console.log('native balance (18 dec):', ethers.formatEther(native), 'USDC')
} catch (e: any) {
  console.error('native balance failed:', e.message)
}

// Test 3: USYC balance
console.log('\nTesting USYC balance...')
try {
  const usycResult = await provider.call({ to: USYC, data: sel + padded })
  console.log('USYC raw:', usycResult)
  console.log('USYC shares:', Number(BigInt(usycResult)))
} catch (e: any) {
  console.error('USYC failed:', e.message)
}
