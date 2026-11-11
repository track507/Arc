import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseClock, chooseRuntime } from "../src/entry.ts";

const SPRING_AFTER = Date.UTC(2026, 2, 8, 7, 0);
const builtIn = Object.getOwnPropertyDescriptor(globalThis, "Temporal");

afterEach(() => {
	if (builtIn !== undefined) {
		Object.defineProperty(globalThis, "Temporal", builtIn);
	}
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("chooseClock", () => {
	it("reads the time zone through Temporal where the runtime has it", () => {
		const zone = vi.spyOn(Temporal.Now, "timeZoneId");
		chooseClock().timezoneOffset(SPRING_AFTER);
		expect(zone).toHaveBeenCalledOnce();
	});

	it("falls back to Date where the runtime has no Temporal at all", () => {
		vi.stubEnv("TZ", "America/New_York");
		Reflect.deleteProperty(globalThis, "Temporal");
		expect(chooseClock().timezoneOffset(SPRING_AFTER)).toBe(240);
	});
});

describe("chooseRuntime", () => {
	it("runs scripts on the engine built from the release", async () => {
		const runtime = await chooseRuntime();
		expect(await runtime.run({ name: "sum.js", source: "1 + 1" })).toEqual({ kind: "value", text: "2" });
	});

	it("holds a runaway script to a memory limit, so a flood of objects leaves the runtime answering", async () => {
		const runtime = await chooseRuntime();
		expect(await runtime.run({ name: "flood.js", source: "var keep = []; for (;;) keep.push({})" })).toMatchObject({ kind: "error" });
		expect(await runtime.run({ name: "after.js", source: "1 + 1" })).toEqual({ kind: "value", text: "2" });
	});
});
