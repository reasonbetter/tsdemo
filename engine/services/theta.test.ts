import { describe, it, expect } from "vitest";
import { thetaService } from "./theta";
import type { ThetaState } from "@/types/kernel";

describe("thetaService", () => {
  it("updates the correct ability key and leaves others untouched", () => {
    const t: ThetaState = { global: { mean: 0, var: 1 }, "causal.aeg": { mean: 0.5, var: 0.8 } };
    const scoring = { theta: { step: 0.2, varDecay: 0.9, minVar: 0.5 } };
    const out = thetaService.update(t, "causal.aeg", { value: 1 }, scoring as any);
    expect(out["causal.aeg"].mean).toBeCloseTo(0.5 + 0.2, 6);
    expect(out["causal.aeg"].var).toBeCloseTo(Math.max(0.5, 0.8 * 0.9), 6);
    expect(out["global"].mean).toBe(0);
  });

  it("handles missing ability key by creating it", () => {
    const t: ThetaState = {};
    const out = thetaService.update(t, "numeric.fermi", { value: 0.5 }, {} as any);
    expect(out["numeric.fermi"].mean).toBeGreaterThan(0);
    expect(out["numeric.fermi"].var).toBeLessThanOrEqual(1);
  });
});
