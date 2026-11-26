/** Test config helpers: the example config resolved through the same pure function the Worker uses. */
import example from "../../../rekauda.config.example";
import { resolveInstance, type Instance } from "../../shared/instance";

export const TEST_INSTANCE: Instance = resolveInstance(example);

export const withInstance = (patch: Partial<Instance>): Instance => ({ ...TEST_INSTANCE, ...patch });
