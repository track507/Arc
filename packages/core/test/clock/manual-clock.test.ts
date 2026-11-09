import { describe, expect, it } from "vitest";

import { ManualClock } from "../../src/clock/manual-clock.ts";

const START = Date.UTC(2026, 10, 8, 12, 0, 0);

describe("ManualClock", () => {
	it("starts at the given time and moves only when advanced", () => {
		const clock = new ManualClock(START);
		expect(clock.now()).toBe(START);
		clock.advance(250);
		expect(clock.now()).toBe(START + 250);
	});

	it("fires a timer once its delay has passed, and not before", () => {
		const clock = new ManualClock(START);
		const fired: number[] = [];
		clock.schedule(100, () => fired.push(clock.now()));
		clock.advance(99);
		expect(fired).toEqual([]);
		clock.advance(1);
		expect(fired).toEqual([START + 100]);
		clock.advance(1000);
		expect(fired).toEqual([START + 100]);
	});

	it("fires timers due at the same time in the order they were scheduled", () => {
		const clock = new ManualClock(START);
		const order: string[] = [];
		clock.schedule(50, () => order.push("a"));
		clock.schedule(10, () => order.push("b"));
		clock.schedule(50, () => order.push("c"));
		clock.advance(50);
		expect(order).toEqual(["b", "a", "c"]);
	});

	it("never fires a cancelled timer, and ignores an unknown id", () => {
		const clock = new ManualClock(START);
		let fired = false;
		const id = clock.schedule(10, () => {
			fired = true;
		});
		clock.cancel(id);
		clock.cancel(id);
		clock.advance(100);
		expect(fired).toBe(false);
	});

	it("fires a timer scheduled while firing when it is due inside the same advance", () => {
		const clock = new ManualClock(START);
		const fired: number[] = [];
		clock.schedule(10, () => {
			fired.push(clock.now());
			clock.schedule(20, () => fired.push(clock.now()));
		});
		clock.advance(30);
		expect(fired).toEqual([START + 10, START + 30]);
	});

	it("treats a negative or NaN delay as zero", () => {
		const clock = new ManualClock(START);
		const fired: Array<[string, number]> = [];
		clock.schedule(-5, () => fired.push(["negative", clock.now()]));
		clock.schedule(Number.NaN, () => fired.push(["nan", clock.now()]));
		clock.advance(0);
		expect(fired).toEqual([
			["negative", START],
			["nan", START],
		]);
	});

	it("rejects moving time backward, or by NaN or Infinity, with the step as the cause", () => {
		const clock = new ManualClock(START);
		for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => {
				clock.advance(ms);
			}).toThrow(expect.objectContaining({ name: "RangeError", cause: { ms } }));
		}
		expect(clock.now()).toBe(START);
	});

	it("reports the time zone offset it was given", () => {
		expect(new ManualClock(START, -60).timezoneOffset(START)).toBe(-60);
		expect(new ManualClock(START).timezoneOffset(START)).toBe(0);
	});
});
