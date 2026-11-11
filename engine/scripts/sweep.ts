import { join } from "node:path";

import { PATCHES } from "../patches/index.ts";
import { buildEngines, DIST, EMSDK, ENGINE, readRelease } from "./compile.ts";
import type { FaultCase, Trial } from "./faults.ts";
import { CASES, caseNamed, faultFolder, trials } from "./faults.ts";
import type { Patch } from "./patches.ts";
import { applyPatches, readFiles } from "./patches.ts";

// * pnpm engine:sweep <case> [--without <patch>]
// Runs a fault case once for every allocation number on the fault build, with that allocation failing, and prints each number's outcome
// With --without it also builds a fault build without one patch and prints both, so the numbers where the two differ are the case's trigger
// That is how a trigger that moved is found again

const USAGE = `usage: pnpm engine:sweep <case> [--without <patch>]\ncases: ${CASES.map((each) => each.name).join(", ")}\n`;

function fail(message: string): never {
	process.stderr.write(`${message}\n${USAGE}`);
	process.exit(1);
}

function patchNamed(name: string): Patch | undefined {
	return PATCHES.find((each) => each.name === name || each.name.startsWith(`${name}-`));
}

/** One trial as a line of text, with the blocks it left measured against the run with none failing */
function show(trial: Trial | undefined, clean: Trial): string {
	if (trial === undefined) return "-";
	const parts = [trial.outcome.length > 60 ? `${trial.outcome.slice(0, 57)}...` : trial.outcome];
	if (!trial.alive && trial.outcome !== "hang" && !trial.outcome.startsWith("trap")) parts.push("then dead");
	if (trial.probe !== "") parts.push(`probe ${trial.probe}`);
	if (trial.alive && trial.blocks !== clean.blocks) parts.push(`blocks ${trial.blocks > clean.blocks ? "+" : ""}${String(trial.blocks - clean.blocks)}`);
	return parts.join(", ");
}

/** Sweeps every allocation of a case on one fault build */
async function sweep(folder: string, fault: FaultCase): Promise<{ readonly clean: Trial; readonly rows: readonly Trial[] }> {
	const [clean] = await trials(folder, fault, 0, 0);
	if (clean === undefined) throw new Error("the run with no allocation failing gave no trial", { cause: { folder, fault: fault.name } });
	return { clean, rows: await trials(folder, fault, 1, clean.allocations) };
}

const [name, flag, patchArgument] = process.argv.slice(2);
const fault = caseNamed(name ?? "") ?? fail(`no case named ${name ?? "(none)"}`);
if (flag !== undefined && flag !== "--without") fail(`unknown option ${flag}`);
const without = flag === undefined ? undefined : (patchNamed(patchArgument ?? "") ?? fail(`no patch named ${patchArgument ?? "(none)"}`));

const release = readRelease();
const files = readFiles(join(ENGINE, "quickjs"), Object.keys(release.files));
await buildEngines({ emsdk: EMSDK, folder: DIST, files: applyPatches(files, PATCHES), version: release.version });
const started = performance.now();
const full = await sweep(faultFolder(DIST), fault);
const columns = [{ title: "every patch", ...full }];
if (without !== undefined) {
	const folder = join(DIST, "without", without.name);
	const kept = PATCHES.filter((each) => each !== without);
	await buildEngines({ emsdk: EMSDK, folder, files: applyPatches(files, kept), version: release.version });
	columns.push({ title: `without ${without.name}`, ...(await sweep(faultFolder(folder), fault)) });
}
const seconds = ((performance.now() - started) / 1000).toFixed(1);

process.stdout.write(`${fault.name}: ${fault.source}\n`);
for (const column of columns)
	process.stdout.write(`  ${column.title}: ${String(column.clean.allocations)} allocations, ${column.clean.outcome} with none failing\n`);
const last = Math.max(...columns.map((column) => column.clean.allocations));
const differ: number[] = [];
for (let n = 1; n <= last; n++) {
	const cells = columns.map((column) =>
		show(
			column.rows.find((row) => row.n === n),
			column.clean
		)
	);
	const marked = cells.length > 1 && cells.some((cell) => cell !== cells[0]);
	if (marked) differ.push(n);
	process.stdout.write(`${marked ? "*" : " "} ${String(n).padStart(4)}  ${cells.join("  |  ")}\n`);
}
const listed = `n ${differ.join(", ")}`;
if (without !== undefined) process.stdout.write(`trigger: ${differ.length === 0 ? "none, the two builds agree at every n" : listed}\n`);
process.stdout.write(`swept in ${seconds} s\n`);
