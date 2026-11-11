import { join } from "node:path";
import { Worker } from "node:worker_threads";

// * The fault cases and the trials that run them on the fault build
// A case is a script that reaches a known fault when one allocation fails, and the allocation numbers that reach it
// ! A trigger is an allocation number, so a change to what the script allocates before the fault moves it, and the case's count of allocations says when it has

/** A script that reaches a known fault when one of its allocations fails on the fault build */
export interface FaultCase {
	/** The name pnpm engine:sweep takes */
	readonly name: string;
	/** The patch that fixes the fault */
	readonly patch: string;
	readonly source: string;
	/** A script run after the case's script, with the hook off, whose outcome shows damage the run left */
	readonly probe?: string;
	/** The allocations the script makes with none failing, which the triggers count from */
	readonly allocations: number;
	/** The allocation numbers, first to last, whose failure reaches the fault without the patch */
	readonly triggers: { readonly from: number; readonly to: number };
}

/**
 * The cases, one or more for each patch whose fault the fault build reaches, with the counts measured on the fault build with every patch
 *
 * ! with-resolvers reaches a double free, which shows only when later allocations reuse the damaged block, so its probe makes 2,000 more resolver sets
 */
export const CASES: readonly FaultCase[] = [
	{ name: "backtrace", patch: "01-backtrace-holds-its-error", source: "null.x", allocations: 31, triggers: { from: 31, to: 31 } },
	{
		name: "unicode-script",
		patch: "02-unicode-script-fails-once",
		source: String.raw`new RegExp("\\p{Script=Greek}", "u")`,
		allocations: 63,
		triggers: { from: 39, to: 48 },
	},
	{
		name: "unicode-script-extensions",
		patch: "02-unicode-script-fails-once",
		source: String.raw`new RegExp("\\p{scx=Greek}", "u")`,
		allocations: 81,
		triggers: { from: 59, to: 66 },
	},
	{ name: "c-string", patch: "03-c-string-frees-on-failure", source: "String.fromCharCode(233).repeat(20)", allocations: 42, triggers: { from: 42, to: 42 } },
	{
		name: "lazy-json",
		patch: "04-lazy-property-survives-failure",
		source: "typeof JSON.parse",
		probe: "typeof JSON.parse",
		allocations: 35,
		triggers: { from: 27, to: 35 },
	},
	{
		name: "with-resolvers",
		patch: "06-define-failures-checked",
		source: "Promise.withResolvers()",
		probe: "var held = []; for (var i = 0; i < 2000; i++) held.push(Promise.withResolvers()); held = null; 'reused'",
		allocations: 57,
		triggers: { from: 51, to: 52 },
	},
];

/** The case with that name, or undefined */
export function caseNamed(name: string): FaultCase | undefined {
	return CASES.find((each) => each.name === name);
}

/** What one run of a case gave with the nth allocation failing */
export interface Trial {
	readonly n: number;
	/** The run's outcome: a value, an error, a timeout, a trap that ended the instance, or a hang that ended the worker */
	readonly outcome: string;
	/** The allocations the run made */
	readonly allocations: number;
	/** Whether the engine then answered 1 + 1 with 2, with the hook off */
	readonly alive: boolean;
	/** The probe's outcome, when the case has one and the engine is alive */
	readonly probe: string;
	/** The blocks the runtime held after the run, the check and the probe, when the engine is alive */
	readonly blocks: number;
}

/** What a trial worker is given */
export interface TrialRequest {
	readonly folder: string;
	readonly source: string;
	readonly probe: string | undefined;
	readonly from: number;
	readonly to: number;
}

/** What a trial worker posts */
export type TrialMessage = { readonly kind: "start"; readonly n: number } | { readonly kind: "trial"; readonly trial: Trial } | { readonly kind: "end" };

/** How long a single run may take before its worker is ended as hung; the engine's own deadline for a run is a fifth of it */
export const HANG_MS = 3000;

const WORKER = new URL("./fault-worker.ts", import.meta.url);

/**
 * Runs the trials from `request.from` in one worker, adding each to `results`, and resolves to the n the next worker starts at
 *
 * ? A run that hangs gives a hang trial and ends the worker, so the next worker starts after it; past `request.to` means every trial ran
 */
async function batch(request: TrialRequest, results: Trial[]): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const worker = new Worker(WORKER, { workerData: request });
		let current = request.from;
		let timer: NodeJS.Timeout | undefined;
		const finish = (after: number): void => {
			clearTimeout(timer);
			void worker.terminate().then(() => {
				resolve(after);
			});
		};
		const arm = (): void => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				results.push({ n: current, outcome: "hang", allocations: 0, alive: false, probe: "", blocks: 0 });
				finish(current + 1);
			}, HANG_MS);
		};
		worker.on("message", (message: TrialMessage) => {
			if (message.kind === "start") {
				current = message.n;
				arm();
			} else if (message.kind === "trial") results.push(message.trial);
			else finish(request.to + 1);
		});
		worker.on("error", (error) => {
			clearTimeout(timer);
			reject(new Error(`the trial worker failed at n ${String(current)}`, { cause: error }));
		});
		arm();
	});
}

/**
 * Runs a script once for each n from `from` to `to` on the fault build in `folder`, each in a fresh engine with the nth allocation failing, n 0 failing none
 *
 * ? A wasm loop blocks the thread it runs on, timers included, so the runs happen in a worker thread and a run that hangs ends the worker, which starts again after it
 * @param folder - the folder holding the fault build's arc-engine.mjs and arc-engine.wasm
 */
export async function trials(folder: string, script: Pick<FaultCase, "source" | "probe">, from: number, to: number): Promise<Trial[]> {
	const results: Trial[] = [];
	let next = from;
	while (next <= to) next = await batch({ folder, source: script.source, probe: script.probe, from: next, to }, results);
	return results;
}

/** The fault build's folder under a folder of builds */
export function faultFolder(dist: string): string {
	return join(dist, "fault");
}
