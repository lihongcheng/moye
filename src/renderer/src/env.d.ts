import type { MoyeBridge } from '../../shared/types'
declare global {
  interface Window { moye?: MoyeBridge }
}
