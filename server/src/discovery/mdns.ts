// mDNS discovery: watch for `_pi-fleet._tcp` services announced by Pi-side
// agents. Manual add (REST) is the other discovery path; this one makes
// new Pis appear without configuration.

import bonjourFactory from 'bonjour';
import type { MdnsService } from 'bonjour';
import type { Config } from '../config.js';
import type { Fleet } from '../state/fleet.js';

export interface MdnsDevice {
  id: string;
  name: string;
  ip: string;
  user?: string;
}

export interface MdnsDiscoveryOpts {
  fleet: Fleet;
  config: Config;
  onUp: (d: MdnsDevice) => void;
  onDown: (d: MdnsDevice) => void;
}

export function startMdnsDiscovery(opts: MdnsDiscoveryOpts): () => void {
  const bonjour = bonjourFactory();
  const seen = new Map<string, MdnsDevice>();

  const browser = bonjour.find({ type: 'pi-fleet' }, (svc: MdnsService) => {
    const ip = svc.addresses?.find((a) => !a.includes(':')) ?? svc.host;
    if (!ip) return;
    const name = svc.name || ip;
    const id = `mdns-${ip.replace(/[^a-z0-9]+/gi, '-')}`;
    const parts = name.split('.');
    const user = parts.length > 1 ? parts[1] : undefined;
    if (seen.has(id)) return;
    const device: MdnsDevice = { id, name, ip, user };
    seen.set(id, device);
    console.log(`[mdns] found ${name} at ${ip}`);
    opts.onUp(device);
  });

  return () => {
    browser.stop();
    bonjour.destroy();
  };
}
