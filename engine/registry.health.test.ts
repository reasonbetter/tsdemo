import { describe, it, expect, beforeEach } from "vitest";
import { __resetRegistryForTests__, registerDriver, resolveDriver, registryHealth } from "@/engine/registry";
import type { SkillDriver } from "@/types/kernel";

const D = (id: string, kind?: string): SkillDriver => ({
  id, kind, version: "1.0.0",
  buildAJInit: () => ({ system: "s", context: null }),
  initUnitState: () => ({}),
  parseAJOutput: (x) => x as any,
  applyTurn: () => ({ credited: 0, budgetSignal: "neutral", newState: {} }),
});

describe("driver registry health", () => {
  beforeEach(() => __resetRegistryForTests__());

  it("reports registered drivers and resolves by id/kind", () => {
    registerDriver(D("aeq.aeg.v1", "aeg"));
    registerDriver(D("generic.numeric.v1", "generic.numeric"));

    const h = registryHealth();
    expect(h.count).toBe(2);

    const aeg = resolveDriver({ kind: "aeg" });
    expect(aeg.id).toBe("aeq.aeg.v1");

    const num = resolveDriver({ driverId: "generic.numeric.v1" });
    expect(num.kind).toBe("generic.numeric");
  });
});
