/* engine/services/theta.ts */
import type { ScorePayload, ThetaState, ScoringSpecification } from "@/types/kernel";

export interface ThetaService {
  update(theta: ThetaState, abilityKey: string, score: ScorePayload | { value: number }, scoringSpec: ScoringSpecification): ThetaState;
  get(theta: ThetaState, abilityKey: string): { mean: number; var: number };
  set(theta: ThetaState, abilityKey: string, comp: { mean: number; var: number }): ThetaState;
}

const DEFAULT_STEP = 0.25;
const DEFAULT_VAR_DECAY = 0.9;
const DEFAULT_MIN_VAR = 0.5;

function get(theta: ThetaState, key: string): { mean: number; var: number } {
  return theta[key] ?? { mean: 0, var: 1 };
}

function set(theta: ThetaState, key: string, comp: { mean: number; var: number }): ThetaState {
  return { ...theta, [key]: comp };
}

export const thetaService: ThetaService = {
  update(theta, abilityKey, scoreLike, scoringSpec) {
    const value = typeof (scoreLike as any).value === "number" ? (scoreLike as any).value : Number(scoreLike) || 0;

    // Pull optional knobs from scoringSpec.theta
    const thetaSpec = scoringSpec?.theta ?? {};
    const step = Number(thetaSpec.step ?? DEFAULT_STEP);
    const varDecay = Math.max(0, Math.min(1, Number(thetaSpec.varDecay ?? DEFAULT_VAR_DECAY)));
    const minVar = Number(thetaSpec.minVar ?? DEFAULT_MIN_VAR);
    // Optional IRT-like discrimination multiplier from scoringSpec.irt.a
    const irtA = Number((scoringSpec as any)?.irt?.a ?? 1);

    const cur = get(theta, abilityKey);
    const mean = cur.mean + (step * irtA) * value;
    const variance = Math.max(minVar, cur.var * varDecay);
    return set(theta, abilityKey, { mean, var: variance });
  },
  get,
  set,
};
