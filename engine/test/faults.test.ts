import { describe, expect, it } from "vitest";

import type { ArcEngine } from "@arc/engine";

import type { FaultEngine } from "../scripts/drive.ts";
import { distFolder, loadEngine, run } from "../scripts/drive.ts";
import type { FaultCase, Trial } from "../scripts/faults.ts";
import { CASES, faultFolder, HANG_MS, trials } from "../scripts/faults.ts";

const MEMORY_LIMIT = 16 * 1024 * 1024;
const DIST = distFolder();
const FAULT = faultFolder(DIST);
const createProduct = await loadEngine<ArcEngine>(DIST);
const createFault = await loadEngine<FaultEngine>(FAULT);

async function product(): Promise<ArcEngine> {
	const engine = await createProduct({ arcShouldStop: () => false });
	expect(engine._arc_start(MEMORY_LIMIT)).toBe(0);
	return engine;
}

async function fault(): Promise<FaultEngine> {
	const engine = await createFault({ arcShouldStop: () => false });
	expect(engine._arc_start(MEMORY_LIMIT)).toBe(0);
	return engine;
}

function faultCase(name: string): FaultCase {
	const found = CASES.find((each) => each.name === name);
	if (found === undefined) throw new Error(`no fault case named ${name}`, { cause: { name } });
	return found;
}

interface Reached {
	readonly clean: Trial;
	readonly trials: readonly Trial[];
}

async function reach(name: string): Promise<Reached> {
	const script = faultCase(name);
	const [clean] = await trials(FAULT, script, 0, 0);
	if (clean === undefined) throw new Error(`${name} gave no trial with none failing`, { cause: { name } });
	expect(clean.allocations, `trigger moved: ${name} makes ${String(clean.allocations)} allocations, not ${String(script.allocations)}`).toBe(
		script.allocations
	);
	return { clean, trials: await trials(FAULT, script, script.triggers.from, script.triggers.to) };
}

type Aftermath = Pick<Trial, "n" | "alive" | "probe"> & { readonly leaked: number };

function aftermath({ clean, trials: reached }: Reached): Aftermath[] {
	return reached.map((trial) => ({ n: trial.n, alive: trial.alive, probe: trial.probe, leaked: Math.max(0, trial.blocks - clean.blocks) }));
}

function unharmed({ clean, trials: reached }: Reached): Aftermath[] {
	return reached.map((trial) => ({ n: trial.n, alive: true, probe: clean.probe, leaked: 0 }));
}

function capturing(): string {
	const names = (prefix: string, count: number): string[] => Array.from({ length: count }, (_, index) => `${prefix}${String(index)}`);
	const parameters = names("a", 32768);
	const locals = names("v", 32767);
	return [
		`function* g(${parameters.join(",")}) {`,
		"  { let x = 1; if (Math.random() < 0) (() => x); }",
		`  var ${locals.join(",")};`,
		`  if (Math.random() < 0) (() => { ${[...parameters, ...locals].join(";")} });`,
		"  yield 1;",
		"}",
		"var it = g(); String(it.next().value);",
	].join("\n");
}

const PROXY = (length: string): string => `new Proxy({}, { ownKeys() { return { length: ${length}, 0: "x" }; } })`;

describe("the fault build", () => {
	it("exports the fault hook beside every entry point of the product", async () => {
		const engine = await fault();
		for (const name of [
			"_arc_start",
			"_arc_input",
			"_arc_run",
			"_arc_output",
			"_arc_output_length",
			"_arc_fail_at",
			"_arc_allocations",
			"_arc_live_blocks",
		] as const) {
			expect(engine[name]).toBeTypeOf("function");
		}
	});

	it("counts the same allocations for a script on every fresh engine", async () => {
		const counts: number[] = [];
		for (let round = 0; round < 3; round++) {
			const engine = await fault();
			engine._arc_fail_at(0);
			run(engine, "count.js", "[1, 2, 3].map((x) => x * 2).join()");
			counts.push(engine._arc_allocations());
		}
		expect(counts[0]).toBeGreaterThan(0);
		expect(new Set(counts).size).toBe(1);
	});

	it("fails the nth allocation and none other", async () => {
		const engine = await fault();
		engine._arc_fail_at(0);
		run(engine, "count.js", "'a'.repeat(1000) + 'b'");
		const count = engine._arc_allocations();
		const last = await fault();
		last._arc_fail_at(count);
		expect(run(last, "last.js", "'a'.repeat(1000) + 'b'").parts.slice(0, 2)).toEqual(["InternalError", "out of memory"]);
		const beyond = await fault();
		beyond._arc_fail_at(count + 1);
		expect(run(beyond, "beyond.js", "'a'.repeat(1000) + 'b'")).toEqual({ code: 0, parts: [`${"a".repeat(1000)}b`] });
	});

	it("counts the live blocks a script keeps, the same number each time it keeps the same thing", async () => {
		const engine = await fault();
		run(engine, "warm.js", "var kept = []; 0");
		const counts: number[] = [];
		for (let round = 0; round < 4; round++) {
			run(engine, "keep.js", "kept.push(new ArrayBuffer(4096)); 0");
			counts.push(engine._arc_live_blocks());
		}
		const added = counts.slice(1).map((count, index) => count - (counts[index] ?? 0));
		expect(added[0]).toBeGreaterThan(0);
		expect(new Set(added).size).toBe(1);
	});

	it("stops a loop past the run's deadline with a timeout, and answers after", async () => {
		const [trial] = await trials(FAULT, { source: "for (;;) {}" }, 0, 0);
		expect(trial).toMatchObject({ outcome: "timeout", alive: true });
	});

	it(
		"reports a native loop the interrupt never reaches as a hang, by ending its worker",
		async () => {
			const [trial] = await trials(FAULT, { source: "Array.prototype.indexOf.call({ length: 2 ** 32 - 1 }, 1)" }, 0, 0);
			expect(trial).toMatchObject({ outcome: "hang", alive: false });
		},
		3 * HANG_MS
	);
});

describe("01-backtrace-holds-its-error", () => {
	it("ends null.x with an error when the stack string cannot be allocated, and answers after", async () => {
		const reached = await reach("backtrace");
		expect(reached.trials.map((trial) => trial.outcome)).toEqual(["error InternalError: out of memory"]);
		expect(aftermath(reached)).toEqual(unharmed(reached));
	});
});

describe("02-unicode-script-fails-once", () => {
	it(
		"ends a Script property that runs out of memory with an error, where the release loops forever",
		async () => {
			const reached = await reach("unicode-script");
			expect(new Set(reached.trials.map((trial) => trial.outcome))).toEqual(new Set(["error SyntaxError: out of memory"]));
			expect(aftermath(reached)).toEqual(unharmed(reached));
		},
		12 * HANG_MS
	);

	it("ends a Script_Extensions property that runs out of memory with an error, where the release frees blocks it already freed", async () => {
		const reached = await reach("unicode-script-extensions");
		expect(new Set(reached.trials.map((trial) => trial.outcome))).toEqual(new Set(["error SyntaxError: out of memory"]));
		expect(aftermath(reached)).toEqual(unharmed(reached));
	});
});

describe("03-c-string-frees-on-failure", () => {
	it("leaks no block when a value's UTF-8 cannot be allocated", async () => {
		const reached = await reach("c-string");
		expect(aftermath(reached)).toEqual(unharmed(reached));
	});
});

describe("04-lazy-property-survives-failure", () => {
	it("keeps JSON and JSON.parse for later runs when making them runs out of memory", async () => {
		const reached = await reach("lazy-json");
		expect(aftermath(reached)).toEqual(unharmed(reached));
		expect(reached.clean.probe).toBe("value function");
	});
});

describe("05-closure-variable-limit", () => {
	it("refuses a function that captures more than 65,535 variables, and answers after", async () => {
		const engine = await product();
		expect(run(engine, "capture.js", capturing()).parts.slice(0, 2)).toEqual(["InternalError", "too variable references"]);
		expect(run(engine, "after.js", "1 + 1")).toEqual({ code: 0, parts: ["2"] });
	}, 60_000);
});

describe("06-define-failures-checked", () => {
	it("frees the values of Promise.withResolvers once when a define fails, so later runs reuse that memory safely", async () => {
		const reached = await reach("with-resolvers");
		expect(aftermath(reached)).toEqual(unharmed(reached));
		expect(reached.clean.probe).toBe("value reused");
	});
});

describe("07-sizes-cannot-wrap", () => {
	it.each([
		["Reflect.ownKeys of a Proxy claiming 0x20000000 keys", `Reflect.ownKeys(${PROXY("0x20000000")}).length`],
		["Reflect.ownKeys of a Proxy claiming 0x20000001 keys", `Reflect.ownKeys(${PROXY("0x20000001")}).length`],
		["Object.keys of that Proxy", `Object.keys(${PROXY("0x20000000")}).length`],
		["for in over that Proxy", `var n = 0; for (var k in ${PROXY("0x20000000")}) n++; n`],
		["JSON.stringify of that Proxy", `JSON.stringify(${PROXY("0x20000000")})`],
		["toReversed on an object of length 0x20000000", "Array.prototype.toReversed.call({ length: 0x20000000 }).length"],
		["toSorted on that object", "Array.prototype.toSorted.call({ length: 0x20000000 }).length"],
		["toSpliced on that object", "Array.prototype.toSpliced.call({ length: 0x20000000 }).length"],
		["with on that object", "Array.prototype.with.call({ length: 0x20000000 }, 0, 1).length"],
	])("ends %s with out of memory, and answers after", async (_, source) => {
		const engine = await product();
		expect(run(engine, "wrap.js", source).parts.slice(0, 2)).toEqual(["InternalError", "out of memory"]);
		expect(run(engine, "after.js", "1 + 1")).toEqual({ code: 0, parts: ["2"] });
	});
});

describe("08-json-indent-rope", () => {
	it("indents with the first ten characters of an indent joined from two long strings", async () => {
		const engine = await product();
		const source = `JSON.stringify({ x: 1 }, null, "a".repeat(600) + "b".repeat(600))`;
		expect(run(engine, "rope.js", source)).toEqual({ code: 0, parts: [`{\n${"a".repeat(10)}"x": 1\n}`] });
	});

	it("does the same with characters outside ASCII", async () => {
		const engine = await product();
		const source = "JSON.stringify({ x: 1 }, null, String.fromCharCode(233).repeat(600) + String.fromCharCode(232).repeat(600))";
		expect(run(engine, "wide.js", source)).toEqual({ code: 0, parts: [`{\n${String.fromCharCode(233).repeat(10)}"x": 1\n}`] });
	});
});
