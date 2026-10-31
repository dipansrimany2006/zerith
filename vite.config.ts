import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { getChain } from './src/onchain-facts'

export default defineConfig(({ mode }) => {
  // The chain the app talks to: VITE_CHAIN_ID 5042002 is Arc Testnet (default), 5042 is Arc mainnet.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const chainId = Number(env.VITE_CHAIN_ID || 5042002)
  const rpc = getChain(chainId)?.rpcUrls[0]
  if (!rpc) throw new Error(`VITE_CHAIN_ID ${chainId} is not in src/onchain-facts.ts`)
  // `--mode mainnet` reads .env.mainnet; refuse to build a mainnet site that would point at a testnet chain or pool.
  if (mode === 'mainnet' && (chainId !== 5042 || !env.VITE_POOL_ADDRESS || !env.VITE_POOL_DEPLOY_BLOCK)) {
    throw new Error('.env.mainnet needs VITE_CHAIN_ID=5042, VITE_POOL_ADDRESS and VITE_POOL_DEPLOY_BLOCK')
  }

  return {
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      // Same-origin path to the chain's RPC, so browser shields and extensions cannot block it.
      '/rpc': {
        target: rpc,
        changeOrigin: true,
        rewrite: () => '/',
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
}
})
