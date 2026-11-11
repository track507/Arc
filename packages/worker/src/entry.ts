import type { Clock, ScriptRuntime } from "@arc/core";
import createArcEngine from "@arc/engine";
import { SystemClock } from "./clock/system-clock.ts";
import type { EngineLimits } from "./runtime/quickjs-runtime.ts";
import { QuickJsRuntime } from "./runtime/quickjs-runtime.ts";

/**
 * The limits the engine holds every run to
 *
 * ? The memory limit is three quarters of the engine's 256 MiB memory maximum, so a runaway script meets the limit's catchable error first and the engine keeps room to answer after it
 * ? The reference sheet's whole session, measured at 105.7 MiB of wasm memory, fits under it
 */
const LIMITS: EngineLimits = { memory: 192 * 1024 * 1024 };

/**
 * Chooses the clock the engine runs on
 *
 * ! The lib types declare Temporal on every runtime, but a bare Temporal throws a ReferenceError on a browser without it, so the entry reads it as an optional property of globalThis
 * @returns {SystemClock} - new instance of clock
 */
export function chooseClock(): Clock {
	return new SystemClock((globalThis as { Temporal?: typeof Temporal }).Temporal);
}

export async function chooseRuntime(): Promise<ScriptRuntime> {
	return QuickJsRuntime.create(createArcEngine, LIMITS);
}
