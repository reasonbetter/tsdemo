// engine/drivers/index.ts
import { registerDriver, setDefaultDriverForKind } from "@/engine/registry";

// Import the concrete drivers
import { AlternativeExplanationGenerationDriver } from "@/engine/drivers/AlternativeExplanationGeneration";
import { GenericNumericDriver } from "@/engine/drivers/GenericNumeric";
import { BiasDirectionDriver } from "@/engine/drivers/BiasDirectionSequential";
// Removed DynamicPathDriver per cleanup
import { BiasDirectionOpenDriver } from "@/engine/drivers/BiasDirectionOpen";

// Register
registerDriver(AlternativeExplanationGenerationDriver);
registerDriver(GenericNumericDriver);
registerDriver(BiasDirectionDriver);
// DynamicPathDriver removed
registerDriver(BiasDirectionOpenDriver);

// Optional defaults (so schemas can specify Engine.kind instead of driverId)
setDefaultDriverForKind("aeg", AlternativeExplanationGenerationDriver.id);
setDefaultDriverForKind("generic.numeric", GenericNumericDriver.id);
setDefaultDriverForKind("bias.direction", BiasDirectionDriver.id);
// dynamic.path default removed
setDefaultDriverForKind("bias.direction.open", BiasDirectionOpenDriver.id);
