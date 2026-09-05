/**
 * mDNS discovery. Pis running the small fleet agent advertise
 * _pi-fleet._tcp; we watch for them and auto-register.
 * Degrades gracefully when bonjour/dnssd is unavailable (e.g. in a container)
 * — manual add and mock mode still work.
 */
export function startMdnsDiscovery({ onFound, serviceType = '_pi-fleet._tcp', enabled = true }) {
  if (!enabled) return { stop() {} };
  let bonjour;
  let browser;
  try {
    // Imported lazily so a missing/failed dep never crashes the server.
    // bonjour 3.x exports a factory: require('bonjour')()
    const factory = requireBonJ();
    bonjour = factory();
    browser = bonjour.find({ type: serviceType }, (svc) => {
      const ip = svc.addresses?.[0];
      if (!ip) return;
      const name = (svc.hostname || svc.name || ip).replace(/\.local\.?$/i, '');
      onFound({ id: mdnsId(name), name, ip, port: svc.port, source: 'mdns' });
    });
    return {
      stop() {
        try { browser?.stop(); } catch { /* ignore */ }
        try { bonjour?.destroy(); } catch { /* ignore */ }
      },
    };
  } catch (e) {
    console.warn(`[discovery] mDNS unavailable (${e.message}) — using manual adds only`);
    return { stop() {} };
  }
}

function requireBonJ() {
  // CommonJS require inside ESM via createRequire
  const { createRequire } = require('node:module');
  const req = createRequire(import.meta.url);
  return req('bonjour');
}

export function mdnsId(name) {
  return `mdns-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export default startMdnsDiscovery;
