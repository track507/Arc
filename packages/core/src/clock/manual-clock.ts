import type { Clock, TimerId } from "./clock.ts";

interface Timer {
	readonly due: number;
	readonly fire: () => void;
}

/**
 * A clock that only moves when told to, for tests and for replaying a recorded session
 *
 * Timers fire in order and timers due at the same moment fire in the order they were scheduled
 */
export class ManualClock implements Clock {
	readonly #timers = new Map<TimerId, Timer>();
	readonly #offset: number;
	#now: number;
	#lastId = 0;

	/**
	 * @param start - the first value of now(), in ms since Unix epoch
	 * @param offsetMinutes - the value timezoneOffset returns
	 */
	constructor(start: number, offsetMinutes = 0) {
		this.#now = start;
		this.#offset = offsetMinutes;
	}

	now(): number {
		return this.#now;
	}

	timezoneOffset(_at: number): number {
		return this.#offset;
	}

	schedule(delay: number, fire: () => void): TimerId {
		this.#lastId += 1;
		const id = this.#lastId as TimerId;
		this.#timers.set(id, { due: this.#now + (delay > 0 ? delay : 0), fire });
		return id;
	}

	cancel(id: TimerId): void {
		this.#timers.delete(id);
	}

	/**
	 * Moves time foward by ms, firing each timer that falls due on the way
	 *
	 * Inside a timer, now() reads that timers due time, and a timer it schedules fires in the same call when it falls due by the end
	 * @param ms - ms to advance
	 * @throws {RangeError} - when ms is negative, NaN or infinite, since an infinite advance never ends while a timer reschedules itself
	 */
	advance(ms: number): void {
		if (!Number.isFinite(ms) || ms < 0)
			throw new RangeError(`ManualClock moves forward by a finite number of milliseconds, got ${String(ms)}`, { cause: { ms } });
		const end = this.#now + ms;
		for (let next = this.#nextDue(end); next !== undefined; next = this.#nextDue(end)) {
			const [id, timer] = next;
			this.#timers.delete(id);
			this.#now = timer.due;
			timer.fire();
		}
		this.#now = end;
	}

	/**
	 * Finds the timer to fire next, among those due by end
	 *
	 * ! A Map iterates in insertion order and ids only grow, so the strict comparison keeps timers due together in the order they were scheduled
	 */
	#nextDue(end: number): [TimerId, Timer] | undefined {
		let best: [TimerId, Timer] | undefined;
		for (const entry of this.#timers) {
			const timer = entry[1];
			if (timer.due > end) continue;
			if (best === undefined || timer.due < best[1].due) best = entry;
		}
		return best;
	}
}
