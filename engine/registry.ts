// engine/registry.ts
import type { SkillDriver } from "@/types/kernel";

type Id = string;
type Kind = string;

const _drivers = new Map<Id, SkillDriver>();
const _defaultsByKind = new Map<Kind, Id>();

export function registerDriver(driver: SkillDriver) {
  if (!driver?.id) throw new Error("registerDriver: driver.id is required");
  if (_drivers.has(driver.id)) throw new Error(`registerDriver: duplicate driver id '${driver.id}'`);
  _drivers.set(driver.id, driver);
}

export function setDefaultDriverForKind(kind: Kind, driverId: Id) {
  if (!_drivers.has(driverId)) throw new Error(`setDefaultDriverForKind: no such driver '${driverId}'`);
  _defaultsByKind.set(kind, driverId);
}

/** Resolve by explicit driverId if present; otherwise by kind→default. */
export function resolveDriver(engine: { driverId?: string; kind?: string }): SkillDriver {
  if (engine?.driverId) {
    const d = _drivers.get(engine.driverId);
    if (!d) throw new Error(`resolveDriver: driverId '${engine.driverId}' not registered`);
    return d;
    }
  if (engine?.kind) {
    const id = _defaultsByKind.get(engine.kind);
    if (!id) throw new Error(`resolveDriver: no default driver for kind '${engine.kind}'`);
    const d = _drivers.get(id);
    if (!d) throw new Error(`resolveDriver: default id '${id}' for kind '${engine.kind}' not registered`);
    return d;
  }
  throw new Error("resolveDriver: Engine requires 'driverId' or 'kind'");
}

/** For observability / /api/registry_health */
export function registryHealth() {
  return {
    count: _drivers.size,
    drivers: Array.from(_drivers.values()).map(d => ({ id: d.id, kind: d.kind ?? null, version: d.version, capabilities: d.capabilities ?? {} })),
    defaults: Object.fromEntries(_defaultsByKind.entries())
  };
}

/** Test-only reset */
export function __resetRegistryForTests__() {
  _drivers.clear();
  _defaultsByKind.clear();
}
