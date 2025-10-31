type Bucket = { tokens: number; lastMs: number };

export function createLimiter({ perMin, burst }: { perMin: number; burst: number }) {
  const buckets = new Map<string, Bucket>();
  const refillPerMs = perMin / 60000; // tokens per ms

  function check(key: string): { ok: boolean; remaining: number; resetSec: number } {
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: burst, lastMs: now };
    const elapsed = now - b.lastMs;
    // Refill tokens based on elapsed time
    const refill = elapsed * refillPerMs;
    b.tokens = Math.min(burst, b.tokens + refill);
    b.lastMs = now;

    if (b.tokens >= 1) {
      b.tokens -= 1;
      buckets.set(key, b);
      return { ok: true, remaining: Math.floor(b.tokens), resetSec: 0 };
    }
    // Time until next full token
    const need = 1 - b.tokens;
    const msUntilNext = Math.ceil(need / refillPerMs);
    buckets.set(key, b);
    return { ok: false, remaining: 0, resetSec: Math.ceil(msUntilNext / 1000) };
  }

  return { check };
}

