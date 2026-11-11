import type { RunOutcome, Script, ScriptRuntime } from "@arc/core";
import type { ArcEngine, ArcHost } from "@arc/engine";

/** Instantiates one engine with fresh memory that asks the host while a run goes on, as the loader that pnpm build:engine generates does */
export type EngineFactory = (host: ArcHost) => Promise<ArcEngine>;

/**
 * Reads milliseconds that only move forward, as performance.now() does
 *
 * ? A run's deadline is measured on it and not on the sheet's clock, which can stand still in a replay or jump with the wall time
 */
export type Stopwatch = () => number;

/** The limits the engine holds every run to, which the entry chooses */
export interface EngineLimits {
	/**
	 * The most bytes the engine's blocks may hold, past which an allocation fails with InternalError: out of memory
	 *
	 * ? A whole number from 0 to 2 ** 32 - 1, since wasm32 counts memory in 32 bits, and 2 ** 32 - 1 sets no limit and leaves only the memory maximum
	 */
	readonly memory: number;

	/** The most milliseconds one run may take on the stopwatch before the engine stops it with a timeout */
	readonly time: number;
}

/** The largest memory limit the engine takes, which is SIZE_MAX in wasm32 */
const LARGEST_MEMORY_LIMIT = 2 ** 32 - 1;

/** The codes arc_run returns, as engine/src/arc-engine.c names them */
const ARC_VALUE = 0;
const ARC_ERROR = 1;
const ARC_UNREADABLE = 2;
const ARC_TIMEOUT = 3;

/** A UTF-16 unit takes at most 3 bytes of UTF-8, since a surrogate pair is 2 units and 4 bytes */
const BYTES_PER_UNIT = 3;

/** The script that checks the engine after an outcome a broken engine could also give, and the text a working one returns */
const CHECK: Script = { name: "check.js", source: "1 + 1" };
const CHECKED = "2";

const DEAD: RunOutcome = { kind: "dead" };
const TIMEOUT: RunOutcome = { kind: "timeout" };

/**
 * What a run reports when the engine could not write its outcome but passes the check after it
 *
 * ? The output buffer fails to grow only when malloc fails, so this is the error QuickJS's JS_ThrowOutOfMemory raises
 */
const OUT_OF_MEMORY: RunOutcome = { kind: "error", name: "InternalError", message: "out of memory", stack: "" };

/** What one call into the engine returned, before the check decides whether the engine still works */
type Call = RunOutcome | { readonly kind: "unreadable" };

const UNREADABLE: Call = { kind: "unreadable" };

/** When the current call into the engine must end, which the engine's interrupt handler asks about */
class Deadline {
	readonly #stopwatch: Stopwatch;
	readonly #limit: number;
	#end = Number.POSITIVE_INFINITY;

	constructor(stopwatch: Stopwatch, limit: number) {
		this.#stopwatch = stopwatch;
		this.#limit = limit;
	}

	/** Starts a call, which may last the limit from now */
	start(): void {
		this.#end = this.#stopwatch() + this.#limit;
	}

	/** Whether the call has passed its end */
	passed(): boolean {
		return this.#stopwatch() > this.#end;
	}
}

/**
 * The script runtime on QuickJS compiled to wasm, with one engine instance for the runtime's life
 *
 * ! A call into the engine that throws, such as a wasm trap or the host's own stack overflow, can stop it with its memory half written, so the runtime is dead from then on
 */
export class QuickJsRuntime implements ScriptRuntime {
	readonly #engine: ArcEngine;
	readonly #deadline: Deadline;
	readonly #encoder = new TextEncoder();
	readonly #decoder = new TextDecoder();
	#dead = false;

	private constructor(engine: ArcEngine, deadline: Deadline) {
		this.#engine = engine;
		this.#deadline = deadline;
	}

	/**
	 * Instantiates an engine and starts its runtime
	 *
	 * ! A memory limit outside the engine's range would wrap silently on its way into wasm, so it is refused before an engine is made
	 * ! A time limit of NaN would never pass, so it is refused with every other number that is not above 0
	 * @throws RangeError when the memory limit is not a whole number from 0 to 2 ** 32 - 1; its cause is `{ memory }`
	 * @throws RangeError when the time limit is not above 0; its cause is `{ time }`
	 * @throws Error when the engine cannot create its runtime or its context; its cause is `{ code }`, the code arc_start returned
	 */
	static async create(factory: EngineFactory, limits: EngineLimits, stopwatch: Stopwatch): Promise<QuickJsRuntime> {
		const { memory, time } = limits;
		if (!Number.isInteger(memory) || memory < 0 || memory > LARGEST_MEMORY_LIMIT) {
			throw new RangeError(`The memory limit must be a whole number of bytes from 0 to ${String(LARGEST_MEMORY_LIMIT)}, and was ${String(memory)}`, {
				cause: { memory },
			});
		}
		if (Number.isNaN(time) || time <= 0) {
			throw new RangeError(`The time limit must be a number of milliseconds above 0, and was ${String(time)}`, { cause: { time } });
		}
		const deadline = new Deadline(stopwatch, time);
		const engine = await factory({ arcShouldStop: () => deadline.passed() });
		const code = engine._arc_start(memory);
		if (code !== 0) throw new Error(`The engine could not start its runtime, arc_start returned ${String(code)}`, { cause: { code } });
		return new QuickJsRuntime(engine, deadline);
	}

	async run(script: Script): Promise<RunOutcome> {
		return Promise.resolve(this.#runNow(script));
	}

	/**
	 * Runs a script and checks the engine after any outcome but a value
	 *
	 * ? An engine left broken by its memory maximum can still hand back an error, so an error or a timeout is believed only when the check after it passes
	 */
	#runNow(script: Script): RunOutcome {
		if (this.#dead) return DEAD;
		const call = this.#call(script);
		if (call.kind === "value") return call;
		if (call.kind !== "dead" && this.#works()) return call.kind === "unreadable" ? OUT_OF_MEMORY : call;
		this.#dead = true;
		return DEAD;
	}

	/** Whether the engine still runs a script and returns the right text */
	#works(): boolean {
		const call = this.#call(CHECK);
		return call.kind === "value" && call.text === CHECKED;
	}

	/**
	 * Writes the script into the engine's input, runs it under a deadline of its own, and reads the outcome
	 *
	 * The input is the name as UTF-8, a NUL byte, the source as UTF-8 and a NUL byte, as arc_run reads it
	 * ! Anything the engine throws is caught here and reported as dead, so a trap can never escape as an exception
	 */
	#call(script: Script): Call {
		try {
			const engine = this.#engine;
			const capacity = (script.name.length + script.source.length) * BYTES_PER_UNIT + 2;
			const input = engine._arc_input(capacity);
			if (input === 0) return DEAD;
			const heap = engine.HEAPU8;
			const end = input + capacity;
			const nameLength = this.#encoder.encodeInto(script.name, heap.subarray(input, end)).written;
			heap[input + nameLength] = 0;
			const source = input + nameLength + 1;
			const sourceLength = this.#encoder.encodeInto(script.source, heap.subarray(source, end)).written;
			heap[source + sourceLength] = 0;
			this.#deadline.start();
			return this.#read(engine._arc_run(nameLength, sourceLength));
		} catch {
			return DEAD;
		}
	}

	/** Turns what arc_run returned into an outcome, or dead when the code and the fields do not match */
	#read(code: number): Call {
		if (code === ARC_UNREADABLE) return UNREADABLE;
		const fields = this.#fields();
		if (code === ARC_TIMEOUT && fields.length === 0) return TIMEOUT;
		const [first = "", second = "", third = ""] = fields;
		if (code === ARC_VALUE && fields.length === 1) return { kind: "value", text: first };
		if (code === ARC_ERROR && fields.length === 3) return { kind: "error", name: first, message: second, stack: third };
		return DEAD;
	}

	/**
	 * Reads the outcome's fields, each a 4-byte little-endian length and that many bytes of UTF-8
	 *
	 * ? The decoder replaces bytes that are not UTF-8 with U+FFFD, which is what the engine's text for a lone surrogate becomes
	 */
	#fields(): string[] {
		const engine = this.#engine;
		const heap = engine.HEAPU8;
		const view = new DataView(heap.buffer, heap.byteOffset, heap.byteLength);
		const fields: string[] = [];
		let at = engine._arc_output();
		const end = at + engine._arc_output_length();
		while (at < end) {
			const length = view.getUint32(at, true);
			fields.push(this.#decoder.decode(heap.subarray(at + 4, at + 4 + length)));
			at += 4 + length;
		}
		return fields;
	}
}
