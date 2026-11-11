import { parentPort, workerData } from "node:worker_threads";

import type { FaultEngine, Raw } from "./drive.ts";
import { loadEngine, run } from "./drive.ts";
import type { Trial, TrialMessage, TrialRequest } from "./faults.ts";
import { HANG_MS } from "./faults.ts";

// * The worker thread behind trials in faults.ts
// Runs a script once for each allocation number it is given, each in a fresh engine, and posts each trial, so the thread that started it can end it when a run hangs

const MEMORY_LIMIT = 16 * 1024 * 1024;
const request = workerData as TrialRequest;
const port = parentPort;
if (port === null) throw new Error("fault-worker.ts runs only as a worker thread", { cause: { request } });

/** A run's outcome as one line of text */
function describe(raw: Raw): string {
	switch (raw.code) {
		case 0:
			return `value ${raw.parts[0] ?? ""}`;
		case 1:
			return `error ${raw.parts[0] ?? ""}: ${raw.parts[1] ?? ""}`;
		case 2:
			return "unreadable";
		case 3:
			return "timeout";
		default:
			return `code ${String(raw.code)}`;
	}
}

/** Runs a script and describes its outcome, or the trap that ended the instance */
function attempt(action: () => Raw): { readonly text: string; readonly trapped: boolean } {
	try {
		return { text: describe(action()), trapped: false };
	} catch (error) {
		return { text: `trap ${String(error)}`, trapped: true };
	}
}

function post(message: TrialMessage): void {
	port?.postMessage(message);
}

const create = await loadEngine<FaultEngine>(request.folder);
for (let n = request.from; n <= request.to; n++) {
	post({ kind: "start", n });
	let deadline = Number.POSITIVE_INFINITY;
	const engine = await create({ arcShouldStop: () => performance.now() > deadline });
	if (engine._arc_start(MEMORY_LIMIT) !== 0) throw new Error("the fault build could not start a runtime", { cause: { n } });
	deadline = performance.now() + HANG_MS / 5;
	engine._arc_fail_at(n);
	const outcome = attempt(() => run(engine, "case.js", request.source));
	const allocations = engine._arc_allocations();
	let alive = false;
	let probe = "";
	let blocks = 0;
	if (!outcome.trapped) {
		engine._arc_fail_at(0);
		deadline = performance.now() + HANG_MS / 5;
		const check = attempt(() => run(engine, "check.js", "1 + 1"));
		alive = check.text === "value 2";
		if (alive && request.probe !== undefined) {
			const probed = attempt(() => run(engine, "probe.js", request.probe ?? ""));
			probe = probed.text;
			alive = !probed.trapped;
		}
		if (alive) blocks = engine._arc_live_blocks();
	}
	const trial: Trial = { n, outcome: outcome.text, allocations, alive, probe, blocks };
	post({ kind: "trial", trial });
}
post({ kind: "end" });
