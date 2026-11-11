import { beforeEach, describe, expect, it } from "vitest";

import type { ArcEngine } from "@arc/engine";
import createArcEngine from "@arc/engine";

interface Raw {
	readonly code: number;
	readonly parts: readonly string[];
}

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

beforeEach(async () => {
	engine = await createArcEngine();
	expect(engine._arc_start()).toBe(0);
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
