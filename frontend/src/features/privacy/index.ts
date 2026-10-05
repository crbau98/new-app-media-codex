/**
 * Public surface of the Vault privacy layer. Other modules should import the
 * narrowest piece they need, e.g. `import { isIncognito } from '@/features/privacy/incognito'`.
 */
export { isIncognito, setIncognito, subscribeIncognito } from './incognito.ts'
export { panic, lockNow } from './vault.ts'
