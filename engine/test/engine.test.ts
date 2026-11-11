import { beforeEach, describe, expect, it } from "vitest";

import type { ArcEngine } from "@arc/engine";
import createArcEngine from "@arc/engine";

interface Raw {
	readonly code: number;
	readonly parts: readonly string[];
}

const MEMORY_LIMIT = 16 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function run(engine: ArcEngine, name: string, source: string): Raw {
	const bytes = encoder.encode(`${name}\0${source}\0`);
	const nameLength = encoder.encode(name).length;
	const input = engine._arc_input(bytes.length);
	engine.HEAPU8.set(bytes, input);
	const code = engine._arc_run(nameLength, bytes.length - nameLength - 2);
	const start = engine._arc_output();
	const end = start + engine._arc_output_length();
	const view = new DataView(engine.HEAPU8.buffer);
	const parts: string[] = [];
	for (let at = start; at < end; at += 4 + view.getUint32(at, true)) {
		parts.push(decoder.decode(engine.HEAPU8.subarray(at + 4, at + 4 + view.getUint32(at, true))));
	}
	return { code, parts };
}

let engine: ArcEngine;
let stopping = false;

beforeEach(async () => {
	stopping = false;
	engine = await createArcEngine({ arcShouldStop: () => stopping });
	expect(engine._arc_start(MEMORY_LIMIT)).toBe(0);
});

describe("the engine's C entry points", () => {
	it("exports every entry point arc-engine.d.ts declares", () => {
		for (const name of ["_arc_start", "_arc_input", "_arc_run", "_arc_output", "_arc_output_length"] as const) {
			expect(engine[name]).toBeTypeOf("function");
		}
	});

	it("returns a value as its text", () => {
		expect(run(engine, "sum.js", "1 + 1")).toEqual({ code: 0, parts: ["2"] });
	});

	it("keeps the global scope from one run to the next", () => {
		run(engine, "first.js", "var level = 40");
		expect(run(engine, "second.js", "level + 2")).toEqual({ code: 0, parts: ["42"] });
	});

	it("carries characters outside ASCII in both directions", () => {
		expect(run(engine, "text.js", "'\u00E9' + '\u{1F600}'")).toEqual({ code: 0, parts: ["\u00E9\u{1F600}"] });
	});

	it("runs a source that holds a NUL character", () => {
		expect(run(engine, "nul.js", "'a\0b'.length")).toEqual({ code: 0, parts: ["3"] });
	});

	it("reports an error by its name, its message and a stack that names the script", () => {
		const { code, parts } = run(engine, "field.js", "null.x");
		expect(code).toBe(1);
		expect(parts.slice(0, 2)).toEqual(["TypeError", "cannot read property 'x' of null"]);
		expect(parts[2]).toContain("field.js");
	});

	it("reports a syntax error the same way", () => {
		expect(run(engine, "broken.js", "1 +").parts.slice(0, 2)).toEqual(["SyntaxError", "unexpected token in expression: ''"]);
	});

	it("reports a thrown value that is not an Error with an empty name and its text as the message", () => {
		expect(run(engine, "throw.js", "throw 42")).toEqual({ code: 1, parts: ["", "42", ""] });
	});

	it("keeps a NUL character inside an error's message", () => {
		expect(run(engine, "nul.js", "throw new Error('a\\0b')").parts[1]).toBe("a\0b");
	});

	it("reports the error that making a value's text throws", () => {
		expect(run(engine, "symbol.js", "Symbol('s')").parts.slice(0, 2)).toEqual(["TypeError", "cannot convert symbol to string"]);
	});

	it("leaves a field empty when reading that property of an error throws", () => {
		const source = "var e = new Error('x'); Object.defineProperty(e, 'message', { get() { throw 1; } }); throw e";
		expect(run(engine, "getter.js", source).parts.slice(0, 2)).toEqual(["Error", ""]);
	});
});

describe("the engine's stack limit", () => {
	it("stops a runaway recursion with a stack overflow the script can catch", () => {
		const source = "function f() { return f() + 1; } try { f(); } catch (e) { e.name + ': ' + e.message }";
		expect(run(engine, "deep.js", source)).toEqual({ code: 0, parts: ["InternalError: stack overflow"] });
	});

	it("answers the next run after a stack overflow", () => {
		run(engine, "deep.js", "function f() { return f() + 1; } f()");
		expect(run(engine, "after.js", "1 + 1")).toEqual({ code: 0, parts: ["2"] });
	});

	it("stops a native recursion that uses much of the host's stack and little of the engine's", () => {
		const source = "var a = []; for (var i = 0; i < 100000; i++) a = [a]; JSON.stringify(a)";
		expect(run(engine, "nested.js", source).parts.slice(0, 2)).toEqual(["InternalError", "stack overflow"]);
	});

	it("stops a parse nested past the limit", () => {
		const source = "eval('('.repeat(100000) + '1' + ')'.repeat(100000))";
		expect(run(engine, "parens.js", source).parts.slice(0, 2)).toEqual(["SyntaxError", "stack overflow"]);
	});

	it("allows a recursion 100 calls deep", () => {
		expect(run(engine, "hundred.js", "function f(n) { return n === 0 ? 0 : 1 + f(n - 1); } f(100)")).toEqual({ code: 0, parts: ["100"] });
	});
});

describe("the engine's memory limit", () => {
	it("stops a runaway allocation with an out of memory error the script can catch", () => {
		const source = "var a = []; try { for (;;) a.push(new ArrayBuffer(1 << 20)); } catch (e) { a = null; e.name + ': ' + e.message }";
		expect(run(engine, "flood.js", source)).toEqual({ code: 0, parts: ["InternalError: out of memory"] });
	});

	it("counts every block at its real size, so the wasm memory stays within twice the limit", () => {
		run(engine, "flood.js", "var head = null; for (;;) head = { next: head }");
		expect(engine.HEAPU8.byteLength).toBeLessThanOrEqual(2 * MEMORY_LIMIT);
	});

	it("counts a block that grows, so one growing array stays within twice the limit", () => {
		run(engine, "grow.js", "var a = []; for (;;) a.push(0)");
		expect(engine.HEAPU8.byteLength).toBeLessThanOrEqual(2 * MEMORY_LIMIT);
	});

	it("takes a freed block off the count, so a run may allocate far more than the limit over its life", () => {
		const source = "var total = 0; for (var i = 0; i < 64; i++) total += new ArrayBuffer(1 << 20).byteLength; total";
		expect(run(engine, "churn.js", source)).toEqual({ code: 0, parts: ["67108864"] });
	});

	it("runs the cycle collector from the count, so a run that drops many cycles stays within twice the limit", () => {
		const source = "for (var i = 0; i < 2000000; i++) { var a = {}; var b = { a: a }; a.b = b; } i";
		expect(run(engine, "cycles.js", source)).toEqual({ code: 0, parts: ["2000000"] });
		expect(engine.HEAPU8.byteLength).toBeLessThanOrEqual(2 * MEMORY_LIMIT);
	});

	it("puts the limit back after it reads an error", () => {
		run(engine, "error.js", "null.x");
		run(engine, "flood.js", "var head = null; for (;;) head = { next: head }");
		expect(engine.HEAPU8.byteLength).toBeLessThanOrEqual(2 * MEMORY_LIMIT);
	});

	it("ends a run that passes the limit with an error, and answers the next run", () => {
		expect(run(engine, "flood.js", "var keep = []; for (;;) keep.push({})").code).toBe(1);
		expect(run(engine, "after.js", "1 + 1")).toEqual({ code: 0, parts: ["2"] });
	});

	it("reads an error in full while the script holds memory at the limit", () => {
		const source = "var e = new Error('\u00E9'.repeat(100000)); var keep = []; try { for (;;) keep.push({}); } catch (x) {} throw e";
		expect(run(engine, "held.js", source).parts[1]).toBe("\u00E9".repeat(100_000));
	});

	it("reports a limit too small for the context", async () => {
		const small = await createArcEngine({ arcShouldStop: () => false });
		expect(small._arc_start(64 * 1024)).toBe(-2);
	});
});

describe("the engine's interrupt", () => {
	it("lets a long loop finish while the host says the run has time left", () => {
		expect(run(engine, "loop.js", "for (var i = 0; i < 1e6; i++) {} i")).toEqual({ code: 0, parts: ["1000000"] });
	});

	it("stops a long loop once the host says the run has passed its deadline", () => {
		stopping = true;
		expect(run(engine, "loop.js", "for (var i = 0; i < 1e6; i++) {} i")).toEqual({ code: 3, parts: [] });
	});

	it("stops a long loop that the script wraps in catch and finally", () => {
		stopping = true;
		const source = "try { for (var i = 0; i < 1e6; i++) {} } catch (e) { 'caught' } finally { 'finally' }";
		expect(run(engine, "caught.js", source)).toEqual({ code: 3, parts: [] });
	});

	it("stops a long loop inside the value's own text", () => {
		stopping = true;
		const source = "({ toString() { for (var i = 0; i < 1e6; i++) {} return 'done'; } })";
		expect(run(engine, "text.js", source)).toEqual({ code: 3, parts: [] });
	});

	it("stops a regular expression that backtracks", () => {
		stopping = true;
		expect(run(engine, "regexp.js", "/(a+)+$/.test('a'.repeat(20) + 'b')")).toEqual({ code: 3, parts: [] });
	});

	it("reports the next run's error as an error after a timeout", () => {
		stopping = true;
		run(engine, "loop.js", "for (var i = 0; i < 1e6; i++) {} i");
		stopping = false;
		expect(run(engine, "field.js", "null.x").code).toBe(1);
	});
});
