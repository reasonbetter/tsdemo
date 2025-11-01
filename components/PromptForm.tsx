import React, { useEffect } from 'react';
import { autosizeGrowOnly } from '../utils/autosize';

export default function PromptForm({
  inputRef,
  value,
  onChange,
  pending,
  ellipsisCount,
  onSubmit,
  onEndSession,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  ellipsisCount: number;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onEndSession: () => void;
}) {
  useEffect(() => {
    if (inputRef?.current) autosizeGrowOnly(inputRef.current, 6);
  }, [value, inputRef]);
  return (
    <form onSubmit={onSubmit}>
      <div className="flex gap-3">
        <textarea
          ref={inputRef}
          className={`flex-1 px-4 py-3 text-base border border-input-border rounded-lg transition duration-150 ease-in-out resize-vertical focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary ${pending ? 'bg-gray-100 cursor-not-allowed' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onInput={(e) => autosizeGrowOnly(e.currentTarget, 6)}
          placeholder="Your answer (a sentence or two)"
          readOnly={pending}
          aria-busy={pending}
          rows={3}
        />
        <div className="flex flex-col gap-3">
          <button type="submit" className="px-6 py-2 text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150 whitespace-nowrap" disabled={pending}>
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
          <button type="button" className="px-6 py-2 text-base font-semibold rounded-lg bg-card text-foreground border border-border hover:bg-gray-50 transition duration-150 whitespace-nowrap" onClick={onEndSession}>
            End Session
          </button>
        </div>
      </div>
    </form>
  );
}
