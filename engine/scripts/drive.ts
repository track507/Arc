import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { ArcEngine, ArcHost } from "@arc/engine";

import { DIST } from "./compile.ts";

// * Drives a built engine at its C entry points, for the engine's tests, the sweep and the upgrade command

/** The fault build's engine: the product's entry points and the fault hook, which only that build exports */
export interface FaultEngine extends ArcEngine {
	/** Makes the nth allocation from now fail, or none with 0, and starts the count again */
	readonly _arc_fail_at: (n: number) => void;
	/** The allocations since the last `_arc_fail_at` */
	readonly _arc_allocations: () => number;
	/** The blocks the runtime holds after a full collection */
	readonly _arc_live_blocks: () => number;
}

/** A run's code, 0 for a value, 1 for an error, 2 for an outcome that could not be written and 3 for a timeout, and the fields it wrote */
export interface Raw {
	readonly code: number;
	readonly parts: readonly string[];
}

/**
 * The part of the WebAssembly API the driver uses, which TypeScript types only in the DOM library
 *
 * ? Node has WebAssembly as a global, and the engine's tsconfig loads Node's types and no DOM
 */
declare const WebAssembly: {
	readonly compile: (bytes: Uint8Array) => Promise<object>;
	readonly instantiate: (module: object, imports: object) => Promise<object>;
};

/** What the loader takes beyond the host's own answers, which Emscripten reads off the module object it is given */
interface LoaderHost extends ArcHost {
	readonly instantiateWasm?: (imports: object, receive: (instance: object) => void) => object;
}

/** Makes a fresh engine, with memory of its own, that asks `host` while a run goes on */
export type Factory<Engine extends ArcEngine> = (host: ArcHost) => Promise<Engine>;

/**
 * The folder holding the builds the engine's tests run on: engine/dist, or another the upgrade command names in ARC_ENGINE_DIST
 *
 * ? The product build is the folder's arc-engine.mjs and the fault build is fault/arc-engine.mjs below it
 */
export function distFolder(): string {
	return process.env["ARC_ENGINE_DIST"] ?? DIST;
}

/**
 * Loads a build's loader and compiles its wasm once, and returns a factory that instantiates that module for each new engine
 *
 * ? Compiling once makes a fresh engine cost an instantiation, which a sweep of every allocation needs
 */
export async function loadEngine<Engine extends ArcEngine>(folder: string): Promise<Factory<Engine>> {
	const loader = (await import(pathToFileURL(join(folder, "arc-engine.mjs")).href)) as { readonly default: (host: LoaderHost) => Promise<Engine> };
	const module = await WebAssembly.compile(readFileSync(join(folder, "arc-engine.wasm")));
	return async (host) =>
		loader.default({
			arcShouldStop: host.arcShouldStop,
			instantiateWasm: (imports, receive) => {
				void WebAssembly.instantiate(module, imports).then(receive);
				return {};
			},
		});
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Runs a script on an engine as a global script, and reads the fields of its outcome */
export function run(engine: ArcEngine, name: string, source: string): Raw {
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
