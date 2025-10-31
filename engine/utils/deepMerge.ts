import type { Json } from "@/types/kernel";

export type ArrayStrategy = "replace" | "concat" | "mergeById";
export interface DeepMergeOptions {
  arrayStrategy?: ArrayStrategy;
  idKey?: string; // for mergeById (e.g., "id")
}

/** Safe immutable deep-merge for plain objects/arrays.
 *  Defaults: arrays "replace" (kernel-level safety).
 */
export function deepMerge<T, U>(
  base: T,
  override: U,
  opts: DeepMergeOptions = { arrayStrategy: "replace" }
): T & U {
  if (override === undefined || override === null) return (clone(base) as any);

  if (isPlain(base) && isPlain(override)) {
    const out: Record<string, any> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(override)]);
    for (const k of keys) {
      const b = (base as any)[k];
      const o = (override as any)[k];
      if (o === undefined) { out[k] = clone(b); continue; }
      if (b === undefined) { out[k] = clone(o); continue; }

      if (Array.isArray(b) && Array.isArray(o)) {
        out[k] = mergeArrays(b, o, opts);
      } else if (isPlain(b) && isPlain(o)) {
        out[k] = deepMerge(b, o, opts);
      } else {
        out[k] = clone(o); // override scalars / type changes
      }
    }
    return out as any;
  }

  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override, opts) as any;
  }

  // Fallback: override replaces base
  return clone(override) as any;
}

function mergeArrays(b: any[], o: any[], opts: DeepMergeOptions): any[] {
  const strat = opts.arrayStrategy ?? "replace";
  if (strat === "replace") return o.map(clone);
  if (strat === "concat") return [...b.map(clone), ...o.map(clone)];
  if (strat === "mergeById") {
    const idKey = opts.idKey ?? "id";
    const byId = new Map<any, any>(b.filter(isPlain).map(x => [x[idKey], clone(x)]));
    for (const el of o) {
      if (isPlain(el) && el[idKey] != null && byId.has(el[idKey])) {
        byId.set(el[idKey], deepMerge(byId.get(el[idKey]), el, opts));
      } else if (isPlain(el) && el[idKey] != null) {
        byId.set(el[idKey], clone(el));
      } else {
        // element without id -> append
        byId.set(Symbol(), clone(el));
      }
    }
    return Array.from(byId.values());
  }
  return o.map(clone);
}

function isPlain(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
}
function clone<T>(x: T): T {
  if (Array.isArray(x)) return x.map(clone) as any;
  if (isPlain(x)) { const out: any = {}; for (const k of Object.keys(x)) out[k] = clone((x as any)[k]); return out; }
  return x;
}
export default deepMerge;
