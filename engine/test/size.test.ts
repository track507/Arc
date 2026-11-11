import { describe, expect, it } from "vitest";

import { DIST } from "../scripts/compile.ts";
import { measure, readSizeRecord } from "../scripts/size.ts";

describe("the engine's size", () => {
	it("matches engine/size.json byte for byte, plain and with brotli", () => {
		expect(measure(DIST)).toEqual(readSizeRecord());
	});
});
