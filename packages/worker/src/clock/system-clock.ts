import type { Clock, TimerId } from "@arc/core";

const NANOSECONDS_PER_MINUTE = 60_000_000_000;

/**
 * The largest absolute time value a Date can hold, in milliseconds
 *
 * @see https://tc39.es/ecma262/#sec-time-values-and-time-range
 */
const MAX_TIME = 8.64e15;

/**
 * The longest delay setTimeout honors, in milliseconds, since a browser stores the delay as a signed 32 bit integer
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#maximum_delay_value
 */
const MAX_DELAY = 2 ** 31 - 1;

/**
 * The browsers clock, reading the time zone through Temporal where the runtime has it and through Date where it does not
 *
 * Both paths return what Chromes Date returns, so a sheet sees the same numbers on every browser
 */
export class SystemClock implements Clock {
	readonly #temporal: typeof Temporal | undefined;

	/**
	 * @param temporal - The runtimes Temporal, or undefined on a browser that has not shipped it
	 */
	constructor(temporal: typeof Temporal | undefined) {
		this.#temporal = temporal;
	}

	now(): number {
		return Date.now();
	}

	timezoneOffset(at: number): number {
		if (this.#temporal === undefined) {
			return wholeMinutes(new Date(at).getTimezoneOffset());
		}
		const time = timeClip(at);
		if (Number.isNaN(time)) {
			return Number.NaN;
		}
		const zone = this.#temporal.Now.timeZoneId();
		const east = this.#temporal.Instant.fromEpochMilliseconds(time).toZonedDateTimeISO(zone).offsetNanoseconds / NANOSECONDS_PER_MINUTE;
		return wholeMinutes(-east);
	}

	/**
	 * ! The id is the setTimeout handle, which is a number in a browser and an object under Node, where only the tests see it
	 */
	schedule(delay: number, fire: () => void): TimerId {
		return setTimeout(fire, Math.min(delay, MAX_DELAY)) as TimerId;
	}

	cancel(id: TimerId): void {
		clearTimeout(id);
	}
}

/**
 * Applies Dates TimeClip: an instant outside Date's range is NaN, and a fraction of a millisecond is dropped
 *
 * ! Temporal throws a RangeError for both, where Date carries on
 * @see https://tc39.es/ecma262/#sec-timeclip
 */
function timeClip(at: number): number {
	return Math.abs(at) <= MAX_TIME ? Math.trunc(at) : Number.NaN;
}

/**
 * Truncates minutes toward zero, as Chromes Date does for an offset with seconds in it, and turns negative zero into zero
 */
function wholeMinutes(minutes: number): number {
	return Math.trunc(minutes) + 0;
}
