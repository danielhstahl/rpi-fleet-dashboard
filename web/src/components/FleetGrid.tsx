import PiCard from './PiCard';
import type { FleetSnapshot } from '../types';

interface FleetGridProps {
  fleet: FleetSnapshot | null;
  selected: string | null;
  onSelect: (id: string) => void;
}

/** Fleet grid: worst-first (highest attention score on top). */
export default function FleetGrid({ fleet, selected, onSelect }: FleetGridProps) {
  if (!fleet) {
    return <div className="empty">Connecting to fleet server…</div>;
  }
  const pis = [...fleet.pis].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return (
    <div className="grid">
      {pis.map((pi) => (
        <PiCard key={pi.id} pi={pi} selected={selected === pi.id} onSelect={onSelect} />
      ))}
    </div>
  );
}
