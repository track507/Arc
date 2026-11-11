import { describe, expect, it } from "vitest";

import type { ArcEngine } from "@arc/engine";
import createArcEngine from "@arc/engine";

import { QuickJsRuntime } from "../../src/runtime/quickjs-runtime.ts";

interface Reply {
	readonly code: number;
	readonly fields: readonly string[];
}

interface Fake {
	readonly engine: ArcEngine;
	readonly sources: string[];
	readonly limits: number[];
}

const INPUT = 1024;
const OUTPUT = 32_768;
const ANSWER: Reply = { code: 0, fields: ["2"] };
const LIMITS = { memory: 16 * 1024 * 1024 };
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fake(answer: (source: string) => Reply, options: { readonly start?: number; readonly input?: number } = {}): Fake {
	const heap = new Uint8Array(65_536);
	const view = new DataView(heap.buffer);
	const sources: string[] = [];
	const limits: number[] = [];
	let outputLength = 0;
	const engine: ArcEngine = {
		HEAPU8: heap,
		_arc_start: (memoryLimit) => {
			limits.push(memoryLimit);
			return options.start ?? 0;
		},
		_arc_input: () => options.input ?? INPUT,
		_arc_run: (nameLength, sourceLength) => {
			const source = decoder.decode(heap.subarray(INPUT + nameLength + 1, INPUT + nameLength + 1 + sourceLength));
			sources.push(source);
			const reply = answer(source);
			let at = OUTPUT;
			for (const field of reply.fields) {
				const bytes = encoder.encode(field);
				view.setUint32(at, bytes.length, true);
				heap.set(bytes, at + 4);
				at += 4 + bytes.length;
			}
			outputLength = at - OUTPUT;
			return reply.code;
		},
		_arc_output: () => OUTPUT,
		_arc_output_length: () => outputLength,
	};
	return { engine, sources, limits };
}

async function runtimeOn(engine: ArcEngine): Promise<QuickJsRuntime> {
	return QuickJsRuntime.create(async () => Promise.resolve(engine), LIMITS);
}

describe("QuickJsRuntime on the engine built from the release", () => {
	it("returns a script's value as its text", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "sum.js", source: "1 + 1" })).toEqual({ kind: "value", text: "2" });
	});

	it("keeps the global scope from one run to the next", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);

		await runtime.run({ name: "first.js", source: "var level = 40" });
		expect(await runtime.run({ name: "second.js", source: "level + 2" })).toEqual({ kind: "value", text: "42" });
	});

	it("reports an error by its name, its message and a stack that names the script, and answers the next run", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "field.js", source: "null.x" })).toEqual({
			kind: "error",
			name: "TypeError",
			message: "cannot read property 'x' of null",
			stack: expect.stringContaining("field.js") as string,
		});
		expect(await runtime.run({ name: "after.js", source: "1 + 1" })).toEqual({ kind: "value", text: "2" });
	});

	it("carries characters outside ASCII in the source, the value and the script's name", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "text.js", source: "'\u00E9' + '\u{1F600}'" })).toEqual({ kind: "value", text: "\u00E9\u{1F600}" });
		expect(await runtime.run({ name: "fich\u00E9.js", source: "null.x" })).toMatchObject({ stack: expect.stringContaining("fich\u00E9.js") as string });
	});

	it("turns a lone surrogate into replacement characters on the way in and on the way out", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "in.js", source: "'\uD800'" })).toEqual({ kind: "value", text: "\uFFFD" });
		expect(await runtime.run({ name: "out.js", source: "'\\uD800'" })).toEqual({ kind: "value", text: "\uFFFD\uFFFD\uFFFD" });
	});

	it("runs a source far longer than the engine's first input buffer", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "long.js", source: `'${"\u00E9".repeat(100_000)}'.length` })).toEqual({ kind: "value", text: "100000" });
	});

	it("reports a run that passes its memory limit as an error, and answers the next run", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, LIMITS);
		expect(await runtime.run({ name: "flood.js", source: "var keep = []; for (;;) keep.push(new ArrayBuffer(1 << 20))" })).toEqual({
			kind: "error",
			name: "InternalError",
			message: "out of memory",
			stack: expect.stringContaining("flood.js") as string,
		});
		expect(await runtime.run({ name: "after.js", source: "1 + 1" })).toEqual({ kind: "value", text: "2" });
	});

	it("is dead once a run fills the memory maximum and the engine can answer nothing after it", async () => {
		const runtime = await QuickJsRuntime.create(createArcEngine, { memory: 2 ** 32 - 1 });
		expect(await runtime.run({ name: "flood.js", source: "var keep = []; for (;;) keep.push({})" })).toEqual({ kind: "dead" });
		expect(await runtime.run({ name: "after.js", source: "1 + 1" })).toEqual({ kind: "dead" });
	});
});

describe("QuickJsRuntime when the engine fails", () => {
	it("refuses a memory limit that would wrap on its way into wasm, before it makes an engine", async () => {
		for (const memory of [-1, 1.5, 2 ** 32]) {
			const { engine, sources } = fake(() => ANSWER);
			let made = 0;
			const factory = async (): Promise<ArcEngine> => {
				made += 1;
				return Promise.resolve(engine);
			};
			await expect(QuickJsRuntime.create(factory, { memory })).rejects.toThrow(expect.objectContaining({ name: "RangeError", cause: { memory } }));
			expect({ made, sources }).toEqual({ made: 0, sources: [] });
		}
	});

	it("passes its memory limit to the engine", async () => {
		const { engine, limits } = fake(() => ANSWER);
		await runtimeOn(engine);
		expect(limits).toEqual([LIMITS.memory]);
	});

	it("creates no runtime when the engine cannot start, with the code it returned as the cause", async () => {
		await expect(runtimeOn(fake(() => ANSWER, { start: -2 }).engine)).rejects.toThrow(expect.objectContaining({ name: "Error", cause: { code: -2 } }));
	});

	it("is dead from the run whose call into the engine throws, and calls the engine no more", async () => {
		const { engine, sources } = fake(() => {
			throw new RangeError("Maximum call stack size exceeded", { cause: { source: "deep.js" } });
		});
		const runtime = await runtimeOn(engine);
		expect(await runtime.run({ name: "deep.js", source: "deep()" })).toEqual({ kind: "dead" });
		expect(await runtime.run({ name: "next.js", source: "1 + 1" })).toEqual({ kind: "dead" });
		expect(sources).toEqual(["deep()"]);
	});

	it("keeps an error when the engine passes the check that follows it", async () => {
		const { engine, sources } = fake((source) => (source === "1 + 1" ? ANSWER : { code: 1, fields: ["TypeError", "boom", "at x.js"] }));
		const runtime = await runtimeOn(engine);
		expect(await runtime.run({ name: "x.js", source: "boom()" })).toEqual({ kind: "error", name: "TypeError", message: "boom", stack: "at x.js" });
		expect(sources).toEqual(["boom()", "1 + 1"]);
	});

	it("is dead when the engine fails the check that follows an error", async () => {
		const { engine } = fake((source) => (source === "1 + 1" ? { code: 0, fields: ["?"] } : { code: 1, fields: ["", "", ""] }));
		const runtime = await runtimeOn(engine);
		expect(await runtime.run({ name: "x.js", source: "boom()" })).toEqual({ kind: "dead" });
		expect(await runtime.run({ name: "next.js", source: "1 + 1" })).toEqual({ kind: "dead" });
	});

	it("reports an outcome the engine could not write as out of memory while the engine still answers", async () => {
		const { engine } = fake((source) => (source === "1 + 1" ? ANSWER : { code: 2, fields: [] }));
		const runtime = await runtimeOn(engine);
		expect(await runtime.run({ name: "big.js", source: "big()" })).toEqual({ kind: "error", name: "InternalError", message: "out of memory", stack: "" });
	});

	it("is dead when the engine cannot give an input buffer", async () => {
		const runtime = await runtimeOn(fake(() => ANSWER, { input: 0 }).engine);
		expect(await runtime.run({ name: "x.js", source: "1 + 1" })).toEqual({ kind: "dead" });
	});

	it("is dead on an outcome whose code or fields it does not know", async () => {
		for (const reply of [
			{ code: 7, fields: ["2"] },
			{ code: 0, fields: ["2", "3"] },
			{ code: 1, fields: ["TypeError"] },
		]) {
			const runtime = await runtimeOn(fake(() => reply).engine);
			expect(await runtime.run({ name: "x.js", source: "x()" })).toEqual({ kind: "dead" });
		}
	});
});
