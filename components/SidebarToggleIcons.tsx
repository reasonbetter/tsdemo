import React from 'react';

export function IconExpand(): JSX.Element {
  // Outward arrows with a center divider: <-|->
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Center divider */}
      <line x1="12" y1="5" x2="12" y2="19" />
      {/* Left arrow pointing left */}
      <path d="M10 7 L6 11 L10 15" />
      {/* Right arrow pointing right */}
      <path d="M14 7 L18 11 L14 15" />
    </svg>
  );
}

export function IconCollapse(): JSX.Element {
  // Inward arrows toward center divider: ->|<-
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Center divider */}
      <line x1="12" y1="5" x2="12" y2="19" />
      {/* Left arrow pointing right */}
      <path d="M6 7 L10 11 L6 15" />
      {/* Right arrow pointing left */}
      <path d="M18 7 L14 11 L18 15" />
    </svg>
  );
}

