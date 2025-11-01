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
  userIdInput,
  setUserIdInput,
  updateUserId,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (v: string) => void;
  pending: boolean;
  ellipsisCount: number;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
  onEndSession: () => void;
  userIdInput: string;
  setUserIdInput: (v: string) => void;
  updateUserId: (v: string) => void | Promise<void>;
}) {
  useEffect(() => {
    if (inputRef?.current) autosizeGrowOnly(inputRef.current, 6);
  }, [value, inputRef]);
  return (
    <form onSubmit={onSubmit}>
      <textarea
        ref={inputRef}
        className={`w-full px-4 py-3 text-base border border-input-border rounded-lg transition duration-150 ease-in-out resize-vertical focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary ${pending ? 'bg-gray-100 cursor-not-allowed' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onInput={(e) => autosizeGrowOnly(e.currentTarget, 6)}
        placeholder="Your answer (a sentence or two)"
        readOnly={pending}
        aria-busy={pending}
        rows={3}
      />
      <div className="mt-4 flex items-center justify-between">
        <div className="hidden">
          <label className="text-sm font-semibold text-primary">User ID:</label>
          <input
            className={`w-36 px-2 py-1 text-sm border rounded-lg transition duration-150 ${'border-input-border focus:ring-primary focus:border-primary'}`}
            value={userIdInput}
            onChange={(e) => setUserIdInput(e.target.value)}
            onBlur={(e) => updateUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                updateUserId((e.target as HTMLInputElement).value);
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Optional"
          />
        </div>
        <button type="submit" className="ml-auto px-4 py-1.5 sm:px-6 sm:py-2 text-sm sm:text-base font-semibold rounded-lg shadow-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-50 transition duration-150 whitespace-nowrap" disabled={pending}>
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
