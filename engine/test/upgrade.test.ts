import { describe, expect, it } from "vitest";

import type { Patch } from "../scripts/patches.ts";
import type { SizeRecord } from "../scripts/size.ts";
import type { TestReport } from "../scripts/upgrade.ts";
import { durationOf, filesLine, format, includesOf, patchesLine, sizeLine, testsLine, timeLine, triggersLine, walkChain } from "../scripts/upgrade.ts";

function patch(name: string, find: string, replace: string): Patch {
	return { name, why: "test", source: { kind: "arc", answers: [] }, edits: [{ file: "a.c", find, replace }] };
}

function report(...results: Array<[status: string, message?: string | undefined, duration?: number]>): TestReport {
	return {
		testResults: [
			{
				assertionResults: results.map(([status, message, duration], index) => ({
					fullName: `test ${String(index + 1)}`,
					status,
					duration: duration ?? 10,
					failureMessages: message === undefined ? [] : [message],
				})),
			},
		],
	};
}

const RECORD: SizeRecord = { wasm: { bytes: 1000, brotli: 400 }, loader: { bytes: 100, brotli: 40 } };

describe("the files check", () => {
	it("passes when every recorded file is there", () => {
		const line = filesLine(["a.c", "a.h"], new Set(["a.c", "a.h"]), new Set(["a.h"]), "record.json");
		expect(line).toMatchObject({ status: "PASS", details: [] });
		expect(line.text).toBe("the 2 files the record lists are all there, and it adds none; a fresh record of the candidate's hashes is in record.json");
	});

	it("fails and names each recorded file the candidate drops", () => {
		expect(filesLine(["a.c", "b.c"], new Set(["a.c"]), new Set(), "record.json")).toMatchObject({ status: "FAIL", details: ["drops b.c"] });
	});

	it("names each file the candidate's sources include that the record lacks", () => {
		expect(filesLine(["a.c"], new Set(["a.c", "new.h"]), new Set(["new.h", "gone.h"]), "record.json").details).toEqual([
			"adds gone.h, which its sources include, though the candidate does not hold it",
			"adds new.h, which its sources include",
		]);
	});

	it("reads the local includes of a C source and not the C library's", () => {
		expect(includesOf('#include <stdio.h>\n#include "cutils.h"\n  #  include "list.h"\n')).toEqual(["cutils.h", "list.h"]);
	});
});

describe("the patches check", () => {
	const files = new Map([["a.c", "int a = 1;\nint b = 2;\n"]]);

	it("passes when every patch applies, and applies each to what the ones before it left", () => {
		const chain = walkChain(files, [patch("01-a", "a = 1", "a = 3"), patch("02-a", "a = 3", "a = 4")]);
		expect(chain.files.get("a.c")).toBe("int a = 4;\nint b = 2;\n");
		expect(patchesLine(chain)).toEqual({
			status: "PASS",
			check: "Patches",
			text: "2 apply, 0 already in the candidate, 0 no longer fit",
			details: ["01-a: applies", "02-a: applies"],
		});
	});

	it("passes over a patch already in the candidate and leaves it out", () => {
		const chain = walkChain(files, [patch("01-b", "b = 0", "b = 2")]);
		expect(chain.files.get("a.c")).toBe("int a = 1;\nint b = 2;\n");
		expect(patchesLine(chain)).toMatchObject({ status: "PASS", details: ["01-b: already in the candidate, so the switch deletes it"] });
	});

	it("fails on a patch that no longer fits, naming its edit and the count, and goes on with the rest", () => {
		const chain = walkChain(files, [patch("01-c", "c = 1", "c = 3"), patch("02-a", "a = 1", "a = 3")]);
		expect(chain.files.get("a.c")).toBe("int a = 3;\nint b = 2;\n");
		expect(patchesLine(chain)).toMatchObject({
			status: "FAIL",
			text: "1 apply, 0 already in the candidate, 1 no longer fit",
			details: ["01-c: no longer fits, edit 1 of 1 in a.c: its find occurs 0 times", "02-a: applies"],
		});
	});
});

describe("the tests and triggers checks", () => {
	it("pass when every engine test passes", () => {
		const tested = report(["passed"], ["passed"]);
		expect(testsLine(tested)).toMatchObject({ status: "PASS", text: "2 engine tests passed on the candidate's builds" });
		expect(triggersLine(tested)).toMatchObject({ status: "PASS" });
	});

	it("fail on a failed engine test and name it", () => {
		expect(testsLine(report(["passed"], ["failed", "AssertionError: expected 1 to be 2\n  at line"]))).toMatchObject({
			status: "FAIL",
			text: "1 engine test failed on the candidate's builds, and 1 passed",
			details: ["test 2: AssertionError: expected 1 to be 2"],
		});
	});

	it("report a moved trigger on the triggers line and not the tests line", () => {
		const tested = report(["failed", "AssertionError: trigger moved: backtrace makes 33 allocations, not 31: expected 33 to be 31"]);
		expect(testsLine(tested)).toMatchObject({ status: "PASS" });
		expect(triggersLine(tested)).toMatchObject({
			status: "FAIL",
			details: ["trigger moved: backtrace makes 33 allocations, not 31: expected 33 to be 31"],
		});
	});

	it("add up the time the tests took", () => {
		expect(durationOf(report(["passed", undefined, 12], ["failed", "x", 30]))).toBe(42);
	});
});

describe("the size check", () => {
	it("passes within 5 percent of the record, and gives both sizes and the change", () => {
		expect(sizeLine({ wasm: { bytes: 1050, brotli: 400 }, loader: { bytes: 100, brotli: 40 } }, RECORD)).toEqual({
			status: "PASS",
			check: "Size",
			text: "the candidate is within 5% of engine/size.json",
			details: [
				"arc-engine.wasm: 1050 bytes against 1000, +5.0%, and 400 with brotli against 400, +0.0%",
				"arc-engine.mjs: 100 bytes against 100, +0.0%, and 40 with brotli against 40, +0.0%",
			],
		});
	});

	it("fails past 5 percent, plain or with brotli", () => {
		expect(sizeLine({ wasm: { bytes: 1000, brotli: 421 }, loader: { bytes: 100, brotli: 40 } }, RECORD).status).toBe("FAIL");
		expect(sizeLine({ wasm: { bytes: 1000, brotli: 400 }, loader: { bytes: 106, brotli: 40 } }, RECORD).status).toBe("FAIL");
	});
});

describe("the time check", () => {
	it("passes within 10 percent of the pinned build", () => {
		expect(timeLine(1100, 1000)).toEqual({
			status: "PASS",
			check: "Time",
			text: "the engine tests took 1.10 s on the candidate against 1.00 s on the pinned build, +10.0%",
			details: [],
		});
	});

	it("warns, and never fails, past 10 percent", () => {
		expect(timeLine(2000, 1000).status).toBe("WARN");
	});
});

describe("a check's line", () => {
	it("reads as its status, its check and its text, with its details indented below", () => {
		expect(format({ status: "FAIL", check: "Files", text: "one missing", details: ["drops b.c"] })).toBe("FAIL  Files: one missing\n        drops b.c");
	});
});
