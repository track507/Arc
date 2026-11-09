// This + manual-clock exists for a few reasons, one of them being Temporal API introduced earlier this year
// We'd preferably want to use Temporal.Now.instant() since it returns time since unix epoch in ms and ns up to 7 precision digits (depends on the browser)
// But safari is always behind the times, also I highly recommend to not use safari anyways for this
// I know this runs in an isolated WASM worker, but safari is just the worst browser...

// Identifies a scheduled timer, so a number from elsewhere cannot be passed to cancel by mistake
export type TimerId = number & { readonly brand: "TimerId" };

/**
 * Wall time, timers and the time zone, as the sheet's scripts see them
 *
 * The engine Workers entry chooses the browsers clock, or a manual clock for tests and for replay
 */
export interface Clock {
	//Milliseconds since the Unix epoch
	now(): number;

	// Minutes to add to local time to reach UTC at at, as Date.prototype.getTimezoneOffset returns them
	timezoneOffset(at: number): number;

	/**
	 * Calls fire once, after delay ms
	 *
	 * A negative or NaN delay counts as zero
	 */
	schedule(delay: number, fire: () => void): TimerId;

	// Stops a timer that has not fired; an unknown or already fired id is ignored
	cancel(id: TimerId): void;
}
