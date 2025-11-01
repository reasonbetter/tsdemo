import React, { useEffect } from 'react';
import { autosizeGrowOnly } from '../utils/autosize';

export default function ProbeForm({
  prompt,
  probeInputRef,
  value,
  onChange,
  pending,
  ellipsisCount,
  onSubmit,
  onEndSession,
}: {
  prompt: string;
  probeInputRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  ellipsisCount: number;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onEndSession: () => void;
}) {
  useEffect(() => {
    if (probeInputRef?.current) autosizeGrowOnly(probeInputRef.current, 6);
  }, [value, probeInputRef]);
  return (
    <form onSubmit={onSubmit} className="animate-fadeIn">
      <div className="bg-primary-light border border-primary-border text-primary-text p-4 rounded-lg italic mb-8 break-words tracking-[-0.01em]">
        {prompt}
      </div>
      <textarea
        ref={probeInputRef}
        className={`w-full px-4 py-3 text-base border border-input-border rounded-lg transition duration-150 ease-in-out resize-vertical focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary ${pending ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => autosizeGrowOnly(e.currentTarget, 6)}
        placeholder="Your answer (a sentence or two)"
        readOnly={pending}
        aria-busy={pending}
        rows={3}
      />
      <div className="flex justify-start sm:justify-end mt-4">
        <button type="submit" className="px-4 py-1.5 sm:px-6 sm:py-2 text-sm sm:text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150" disabled={pending}>
          {pending ? (
            <span className="flex items-center">
              Thinking
              <span className="w-6 text-left">
                {'.'.repeat(ellipsisCount)}
                <span className="opacity-0">{'.'.repeat(3 - ellipsisCount)}</span>
              </span>
            </span>
          ) : 'Submit'}
        </button>
      </div>
    </form>
  );
}
