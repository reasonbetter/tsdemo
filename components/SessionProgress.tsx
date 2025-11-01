import React from 'react';

export default function SessionProgress({ current, total }: { current: number; total: number }) {
  if (!total || total <= 0) return null;
  const clamped = Math.max(0, Math.min(current, total));
  const segments = Array.from({ length: total }, (_, i) => i < clamped);
  return (
    <div className="mb-4">
      <div className="text-sm text-muted-foreground mb-2">Question {clamped} of {total}</div>
      <div className="flex gap-2" aria-label={`Progress: ${clamped} of ${total}`}>
        {segments.map((filled, idx) => (
          <div
            key={idx}
            className={`h-2 flex-1 rounded-full transition-colors duration-300 ${filled ? 'bg-primary' : 'bg-gray-200'}`}
          />
        ))}
      </div>
    </div>
  );
}
