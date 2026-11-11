/** The engine's wasm instance, as the loader that pnpm build:engine generates returns it */
export interface ArcEngine {
	/** The instance's memory as bytes; the view is replaced when the memory grows, so it is read again after every call */
	readonly HEAPU8: Uint8Array;
	/** Creates the runtime and its context under a memory limit in bytes, and returns 0, or a negative number when one cannot be made */
	readonly _arc_start: (memoryLimit: number) => number;
	/** Returns the address of an input buffer of at least `size` bytes, or 0 when memory runs out */
	readonly _arc_input: (size: number) => number;
	/** Runs the input as a global script, and returns 0 for a value, 1 for an error and 2 when the outcome could not be written */
	readonly _arc_run: (nameLength: number, sourceLength: number) => number;
	/** The address of the outcome: fields, each a 4-byte little-endian length and that many bytes of UTF-8 */
	readonly _arc_output: () => number;
	/** The outcome's length in bytes */
	readonly _arc_output_length: () => number;
}

/** What the engine asks the JavaScript side while a run goes on */
export interface ArcHost {
	/** Answers whether the current run has passed its deadline, which the engine asks once every 10,000 jumps and calls */
	readonly arcShouldStop: () => boolean;
}

/**
 * Instantiates a fresh engine, with its own memory, that asks the host while a run goes on
 *
 * ! The loader writes the engine's exports onto the host object and resolves to it, so each engine needs a host object of its own
 */
export default function createArcEngine(host: ArcHost): Promise<ArcEngine>;
