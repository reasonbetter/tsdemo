import React from 'react';

export default function TransitionMessage({ message }: { message: string }) {
  return (
    <div className="animate-fadeIn">
      <div className="bg-primary-light border border-primary-border text-primary-text p-4 rounded-lg italic mb-4 break-words tracking-[-0.01em]">
        {message}
      </div>
    </div>
  );
}

