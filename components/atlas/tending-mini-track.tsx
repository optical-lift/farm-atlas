import type { TendingBedTrack } from "@/lib/atlas/tending-client";

export default function TendingMiniTrack({ track }: { track: TendingBedTrack }) {
  const gates = track.gates.filter((gate) => gate.status !== "skipped").slice(0, 7);
  if (gates.length < 2) return null;

  return (
    <ol className="atlas-tending-mini-track" aria-label={`${track.bedLabel} path to harvest`}>
      {gates.map((gate, index) => (
        <li key={`${gate.key}:${gate.dueDate ?? index}`} className={`gate-${gate.status}`}>
          <i aria-hidden="true" />
          <span>{gate.label}</span>
        </li>
      ))}
    </ol>
  );
}
