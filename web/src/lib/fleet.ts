/**
 * Live fleet state via the server WebSocket.
 * - `fleet`: latest snapshot (5s cadence + immediate pushes)
 * - `journal[pi]`: appended live journal lines (subscribed Pis)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FleetSnapshot, JournalLine, WsServerMsg } from '../types';

/** Boundary guard for untrusted ws payloads (JSON.parse returns `unknown`). */
function isWsServerMsg(m: unknown): m is WsServerMsg {
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof (m as { type?: unknown }).type === 'string'
  );
}

export function useFleet() {
  const [fleet, setFleet] = useState<FleetSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [journal, setJournal] = useState<Record<string, JournalLine[]>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const subs = useRef<Set<string>>(new Set());

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;

    const connect = (): void => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        subs.current.forEach((pi) => {
          const msg = { type: 'subscribe', pi } as const;
          socket.send(JSON.stringify(msg));
        });
      };
      socket.onmessage = (e: MessageEvent) => {
        let msg: unknown;
        try {
          msg = JSON.parse(e.data as string);
        } catch {
          return;
        }
        if (!isWsServerMsg(msg)) return;
        if (msg.type === 'fleet') {
          setFleet(msg.data);
        } else if (msg.type === 'journal') {
          setJournal((prev) => {
            const arr = (prev[msg.pi] ?? []).concat(msg.line);
            return { ...prev, [msg.pi]: arr.slice(-400) };
          });
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    };
    connect();

    return () => {
      closed = true;
      window.clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, []);

  const subscribeJournal = useCallback((pi: string) => {
    subs.current.add(pi);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const msg = { type: 'subscribe', pi } as const;
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const unsubscribeJournal = useCallback((pi: string) => {
    subs.current.delete(pi);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const msg = { type: 'unsubscribe', pi } as const;
      ws.send(JSON.stringify(msg));
    }
  }, []);

  return { fleet, connected, journal, subscribeJournal, unsubscribeJournal };
}
