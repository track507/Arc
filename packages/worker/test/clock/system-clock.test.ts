import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemClock } from "../../src/clock/system-clock.ts";

const START = Date.UTC(2026, 10, 8, 12, 0, 0);
const SPRING_BEFORE = Date.UTC(2026, 2, 8, 6, 59);
const SPRING_AFTER = Date.UTC(2026, 2, 8, 7, 0);
const AUTUMN_BEFORE = Date.UTC(2026, 10, 1, 5, 59);
const AUTUMN_AFTER = Date.UTC(2026, 10, 1, 6, 0);

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe.each([
	{ path: "Temporal", temporal: Temporal },
	{ path: "Date", temporal: undefined },
])("SystemClock through $path", ({ temporal }) => {
	it("reports the offset on each side of the spring change in New York", () => {
		vi.stubEnv("TZ", "America/New_York");
		const clock = new SystemClock(temporal);
		expect(clock.timezoneOffset(SPRING_BEFORE)).toBe(300);
		expect(clock.timezoneOffset(SPRING_AFTER)).toBe(240);
	});

	it("reports the offset on each side of the autumn change in New York", () => {
		vi.stubEnv("TZ", "America/New_York");
		const clock = new SystemClock(temporal);
		expect(clock.timezoneOffset(AUTUMN_BEFORE)).toBe(240);
		expect(clock.timezoneOffset(AUTUMN_AFTER)).toBe(300);
	});

	it("reports a zone east of UTC as negative minutes, including a 45 minute offset", () => {
		vi.stubEnv("TZ", "Asia/Kathmandu");
		expect(new SystemClock(temporal).timezoneOffset(START)).toBe(-345);
	});

	it("reports UTC as zero, never negative zero", () => {
		vi.stubEnv("TZ", "UTC");
		expect(new SystemClock(temporal).timezoneOffset(START)).toBe(0);
	});

	it("truncates an offset that is not a whole number of minutes toward zero", () => {
		vi.stubEnv("TZ", "America/Chicago");
		expect(new SystemClock(temporal).timezoneOffset(Date.UTC(1850, 0, 1))).toBe(350);
		vi.stubEnv("TZ", "Europe/Moscow");
		expect(new SystemClock(temporal).timezoneOffset(Date.UTC(1900, 0, 1))).toBe(-150);
	});

	it("drops a fraction of a millisecond, as Date does", () => {
		vi.stubEnv("TZ", "America/New_York");
		expect(new SystemClock(temporal).timezoneOffset(SPRING_AFTER + 0.5)).toBe(240);
	});

	it("reports NaN for an instant Date cannot hold", () => {
		const clock = new SystemClock(temporal);
		expect(clock.timezoneOffset(Number.NaN)).toBeNaN();
		expect(clock.timezoneOffset(Number.POSITIVE_INFINITY)).toBeNaN();
		expect(clock.timezoneOffset(8.64e15 + 1)).toBeNaN();
	});

	it("reads the wall time from the system", () => {
		vi.useFakeTimers({ now: START });
		expect(new SystemClock(temporal).now()).toBe(START);
	});

	it("fires a timer once its delay has passed, and not before", () => {
		vi.useFakeTimers({ now: START });
		const clock = new SystemClock(temporal);
		const fired: number[] = [];
		clock.schedule(100, () => fired.push(clock.now()));
		vi.advanceTimersByTime(99);
		expect(fired).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(fired).toEqual([START + 100]);
		vi.advanceTimersByTime(1000);
		expect(fired).toEqual([START + 100]);
	});

	it("never fires a cancelled timer, and ignores an unknown id", () => {
		vi.useFakeTimers({ now: START });
		const clock = new SystemClock(temporal);
		let fired = false;
		const id = clock.schedule(10, () => {
			fired = true;
		});
		clock.cancel(id);
		clock.cancel(id);
		vi.advanceTimersByTime(100);
		expect(fired).toBe(false);
	});

	it("treats a negative or NaN delay as zero", () => {
		vi.useFakeTimers({ now: START });
		const clock = new SystemClock(temporal);
		const fired: Array<[string, number]> = [];
		clock.schedule(-5, () => fired.push(["negative", clock.now()]));
		clock.schedule(Number.NaN, () => fired.push(["nan", clock.now()]));
		vi.advanceTimersByTime(0);
		expect(fired).toEqual([
			["negative", START],
			["nan", START],
		]);
	});

	it("waits the longest a timer can for a delay past 2^31 - 1 milliseconds", () => {
		vi.useFakeTimers({ now: START });
		const clock = new SystemClock(temporal);
		let fired = false;
		clock.schedule(2 ** 31, () => {
			fired = true;
		});
		vi.advanceTimersByTime(2 ** 31 - 2);
		expect(fired).toBe(false);
		vi.advanceTimersByTime(1);
		expect(fired).toBe(true);
	});
});

describe("SystemClock through Date on another engine", () => {
	it("truncates a fractional offset toward zero, and never reports negative zero", () => {
		const clock = new SystemClock(undefined);
		vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValueOnce(350.6).mockReturnValueOnce(-0.5);
		expect(clock.timezoneOffset(START)).toBe(350);
		expect(clock.timezoneOffset(START)).toBe(0);
	});
});
