import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseClock } from "../src/entry.ts";

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
