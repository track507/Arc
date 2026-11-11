import type { Clock, ScriptRuntime } from "@arc/core";
import createArcEngine from "@arc/engine";
import { SystemClock } from "./clock/system-clock.ts";
import { QuickJsRuntime } from "./runtime/quickjs-runtime.ts";

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
	return QuickJsRuntime.create(createArcEngine);
}
