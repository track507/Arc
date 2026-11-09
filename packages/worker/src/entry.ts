import type { Clock } from "@arc/core";
import { SystemClock } from "./clock/system-clock.ts";

/**
 * Chooses the clock the engine runs on, which is the one choice the engine Workers entry makes so far
 *
 * ! The lib types declare Temporal on every runtime, but a bare Temporal throws a ReferenceError on a browser without it, so the entry reads it as an optional property of globalThis
 * @returns {SystemClock} - new instance of clock
 */
export function chooseClock(): Clock {
	return new SystemClock((globalThis as { Temporal?: typeof Temporal }).Temporal);
}
