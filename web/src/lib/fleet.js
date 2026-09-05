/**
 * Live fleet state via the server WebSocket.
 * - `fleet`: latest snapshot (5s cadence + immediate pushes)
 * - `journal[pi]`: appended live journal lines (subscribed Pis)
 * - `upgrades[pi]`: appended upgrade progress lines
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useFleet() {
  const [fleet, setFleet] = useState(null);
  const [connected, setConnected] = useState(false);
  const [journal, setJournal] = useState({}); // pi -> array of lines
  const [upgrades, setUpgrades] = useState({}); // pi -> {lines:[], done:null}
  const wsRef = useRef(null);
  const subs = useRef(new Set());

  useEffect(() => {
    let closed = false;
    let retry = null;
    let ws = null;

    const connect = () => {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        subs.current.forEach((pi) => ws.send(JSON.stringify({ type: 'subscribe', pi })));
      };
      ws.onmessage = (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'fleet') setFleet(msg.data);
        else if (msg.type === 'journal') {
          setJournal((prev) => {
            const arr = (prev[msg.pi] || []).concat(msg.line);
            return { ...prev, [msg.pi]: arr.slice(-400) };
          });
        } else if (msg.type === 'upgrade') {
          setUpgrades((prev) => {
            const cur = prev[msg.pi] || { lines: [], done: null };
            return {
              ...prev,
              [msg.pi]: msg.done
                ? { lines: cur.lines, done: msg.ok }
                : { lines: cur.lines.concat(msg.line).slice(-200), done: null },
            };
          });
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, []);

  const subscribeJournal = useCallback((pi) => {
    subs.current.add(pi);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', pi }));
    }
  }, []);

  const unsubscribeJournal = useCallback((pi) => {
    subs.current.delete(pi);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', pi }));
    }
  }, []);

  const clearUpgrade = useCallback((pi) => {
    setUpgrades((prev) => {
      const next = { ...prev };
      delete next[pi];
      return next;
    });
  }, []);

  return { fleet, connected, journal, upgrades, subscribeJournal, unsubscribeJournal, clearUpgrade };
}
