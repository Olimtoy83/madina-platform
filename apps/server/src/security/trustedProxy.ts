export const firstPilotTrustedProxyAddresses = [
  '127.0.0.1',
  '::1',
] as const

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1'
}
