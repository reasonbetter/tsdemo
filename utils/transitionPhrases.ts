// Rotation of canned transition phrases with no repeats until exhaustion.

const PHRASES: string[] = [
  "Ok! Let’s move on to the next question.",
  "All set. Next question coming up.",
  "Thanks. Let's keep going.",
  "All right, onward to the next one.",
  "Got it. Ready for the next one?",
  "We're making progress! Here's the next question.",
  "Forging ahead! Get ready for the next question.",
  "Ok, just processing your next question...",
];

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let queue: string[] = shuffle(PHRASES);

export function resetTransitionPhrases(): void {
  queue = shuffle(PHRASES);
}

export function nextTransitionPhrase(): string {
  if (queue.length === 0) {
    queue = shuffle(PHRASES);
  }
  return queue.shift() as string;
}

export const DEFAULT_TRANSITION_DELAY_MS = 3200; // ~2x default, per request
