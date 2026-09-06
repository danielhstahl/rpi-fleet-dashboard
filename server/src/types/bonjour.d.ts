// Minimal type surface for the `bonjour` v3 factory API (the published
// @types/bonjour describes the older 1.x shape).
declare module 'bonjour' {
  export interface MdnsService {
    name: string;
    type: string;
    host?: string;
    hostname?: string;
    addresses?: string[];
    port?: number;
  }
  export interface MdnsBrowser {
    stop(): void;
  }
  export interface Mdns {
    find(options: { type: string }, onup?: (service: MdnsService) => void): MdnsBrowser;
    destroy(): void;
  }
  function bonjour(options?: Record<string, unknown>): Mdns;
  export default bonjour;
}
