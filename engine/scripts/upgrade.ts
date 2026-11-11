import type { Files, Fit, Patch } from "./patches.ts";
import { applyPatches, fitOf } from "./patches.ts";
import type { Measure, SizeRecord } from "./size.ts";

// * The checks of pnpm engine:check-upgrade, apart from the I/O that feeds them
// Each check gives one line of PASS, FAIL or WARN, and any FAIL makes the command exit with 1

export type Status = "PASS" | "FAIL" | "WARN";

/** One check's line, and the lines under it that give each part */
export interface Line {
	readonly status: Status;
	readonly check: string;
	readonly text: string;
	readonly details: readonly string[];
}

/** How much larger than the record the candidate may be, plain or with brotli; a margin chosen, not derived */
export const SIZE_MARGIN = 0.05;
/** How much slower the engine tests may run on the candidate before the command warns */
export const TIME_MARGIN = 0.1;

/** Formats a check's line and its details for the terminal */
export function format(line: Line): string {
	return [`${line.status}  ${line.check}: ${line.text}`, ...line.details.map((detail) => `        ${detail}`)].join("\n");
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * The files check: every file the record lists must be in the candidate
 *
 * @param recorded - the files engine/release.json lists
 * @param present - the files the candidate holds, of those and of the files its sources include
 * @param included - the local files the candidate's sources include
 */
export function filesLine(recorded: readonly string[], present: ReadonlySet<string>, included: ReadonlySet<string>, recordPath: string): Line {
	const dropped = recorded.filter((name) => !present.has(name));
	const added = [...included].filter((name) => !recorded.includes(name)).sort((a, b) => a.localeCompare(b));
	const details = [
		...dropped.map((name) => `drops ${name}`),
		...added.map((name) => `adds ${name}, which its sources include${present.has(name) ? "" : ", though the candidate does not hold it"}`),
	];
	const record = `a fresh record of the candidate's hashes is in ${recordPath}`;
	if (dropped.length > 0)
		return { status: "FAIL", check: "Files", text: `the candidate lacks ${plural(dropped.length, "file")} the record lists; ${record}`, details };
	const extra = added.length === 0 ? "it adds none" : `it adds ${plural(added.length, "file")}`;
	return { status: "PASS", check: "Files", text: `the ${plural(recorded.length, "file")} the record lists are all there, and ${extra}; ${record}`, details };
}

/** What the chain gives on a candidate: how each patch stands, and the files with every patch that applies */
export interface Chain {
	readonly fits: ReadonlyArray<{ readonly patch: Patch; readonly fit: Fit }>;
	readonly files: Map<string, string>;
}

/** Walks the chain over the candidate in order, applying each patch that applies to the text the ones before it left */
export function walkChain(candidate: Files, patches: readonly Patch[]): Chain {
	let files = new Map(candidate);
	const fits: Array<{ readonly patch: Patch; readonly fit: Fit }> = [];
	for (const patch of patches) {
		const fit = fitOf(files, patch);
		if (fit.kind === "applies") files = applyPatches(files, [patch]);
		fits.push({ patch, fit });
	}
	return { fits, files };
}

function describeFit({ patch, fit }: Chain["fits"][number]): string {
	switch (fit.kind) {
		case "applies":
			return `${patch.name}: applies`;
		case "present":
			return `${patch.name}: already in the candidate, so the switch deletes it`;
		case "misfit": {
			const why = fit.partly ? "its replace is already there, so the candidate holds part of the patch" : `its find occurs ${String(fit.count)} times`;
			return `${patch.name}: no longer fits, edit ${String(fit.edit)} of ${String(patch.edits.length)} in ${fit.file}: ${why}`;
		}
	}
}

/** The patches check: it fails when a patch no longer fits */
export function patchesLine(chain: Chain): Line {
	const count = (kind: Fit["kind"]): number => chain.fits.filter(({ fit }) => fit.kind === kind).length;
	const misfits = count("misfit");
	const text = `${String(count("applies"))} apply, ${String(count("present"))} already in the candidate, ${String(misfits)} no longer fit`;
	return { status: misfits > 0 ? "FAIL" : "PASS", check: "Patches", text, details: chain.fits.map(describeFit) };
}

function change(now: number, then: number): string {
	const percent = ((now - then) / then) * 100;
	return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`;
}

function sizeDetail(name: string, now: Measure, then: Measure): string {
	return `${name}: ${String(now.bytes)} bytes against ${String(then.bytes)}, ${change(now.bytes, then.bytes)}, and ${String(now.brotli)} with brotli against ${String(then.brotli)}, ${change(now.brotli, then.brotli)}`;
}

/** The size check: it fails when the candidate's product build is more than SIZE_MARGIN larger than the record, plain or with brotli */
export function sizeLine(now: SizeRecord, then: SizeRecord): Line {
	const measures = [
		now.wasm.bytes / then.wasm.bytes,
		now.wasm.brotli / then.wasm.brotli,
		now.loader.bytes / then.loader.bytes,
		now.loader.brotli / then.loader.brotli,
	];
	const over = measures.some((ratio) => ratio > 1 + SIZE_MARGIN);
	const text = over
		? `the candidate is more than ${String(SIZE_MARGIN * 100)}% larger than engine/size.json`
		: `the candidate is within ${String(SIZE_MARGIN * 100)}% of engine/size.json`;
	return {
		status: over ? "FAIL" : "PASS",
		check: "Size",
		text,
		details: [sizeDetail("arc-engine.wasm", now.wasm, then.wasm), sizeDetail("arc-engine.mjs", now.loader, then.loader)],
	};
}

/** The time check: it never fails, and warns when the engine tests run more than TIME_MARGIN slower on the candidate than on the pinned build */
export function timeLine(candidateMs: number, pinnedMs: number): Line {
	const slower = candidateMs > pinnedMs * (1 + TIME_MARGIN);
	const text = `the engine tests took ${(candidateMs / 1000).toFixed(2)} s on the candidate against ${(pinnedMs / 1000).toFixed(2)} s on the pinned build, ${change(candidateMs, pinnedMs)}`;
	return { status: slower ? "WARN" : "PASS", check: "Time", text, details: [] };
}

/** One test's result, as Vitest's JSON report gives it */
export interface TestResult {
	readonly fullName: string;
	readonly status: string;
	readonly duration?: number | null;
	readonly failureMessages: readonly string[];
}

/** Vitest's JSON report, as far as the command reads it */
export interface TestReport {
	readonly testResults: ReadonlyArray<{ readonly assertionResults: readonly TestResult[] }>;
}

/** The tests of a report, flat */
export function resultsOf(report: TestReport): TestResult[] {
	return report.testResults.flatMap((file) => file.assertionResults);
}

/** The total time the tests of a report took, in milliseconds */
export function durationOf(report: TestReport): number {
	return resultsOf(report).reduce((total, result) => total + (result.duration ?? 0), 0);
}

const MOVED = "trigger moved";

function firstLine(result: TestResult): string {
	return (result.failureMessages[0] ?? "").split("\n")[0] ?? "";
}

/** The tests check: it fails on any failed engine test, apart from a fault test whose trigger moved, which the triggers check reports */
export function testsLine(report: TestReport): Line {
	const results = resultsOf(report);
	const failed = results.filter((result) => result.status === "failed" && !result.failureMessages.some((message) => message.includes(MOVED)));
	const passed = results.filter((result) => result.status === "passed").length;
	if (failed.length > 0)
		return {
			status: "FAIL",
			check: "Tests",
			text: `${plural(failed.length, "engine test")} failed on the candidate's builds, and ${String(passed)} passed`,
			details: failed.map((result) => `${result.fullName}: ${firstLine(result)}`),
		};
	return { status: "PASS", check: "Tests", text: `${plural(passed, "engine test")} passed on the candidate's builds`, details: [] };
}

/** The triggers check: it fails when a fault case's allocation count moved, which leaves that fix unchecked until the trigger is found again */
export function triggersLine(report: TestReport): Line {
	const moved = resultsOf(report).filter((result) => result.failureMessages.some((message) => message.includes(MOVED)));
	if (moved.length > 0)
		return {
			status: "FAIL",
			check: "Triggers",
			text: `${plural(moved.length, "fault test")} found the allocations before its fault moved, so its fix is unchecked; find each again with pnpm engine:sweep`,
			details: moved.map((result) => {
				const message = result.failureMessages.find((each) => each.includes(MOVED)) ?? "";
				return message.slice(message.indexOf(MOVED)).split("\n")[0] ?? "";
			}),
		};
	return { status: "PASS", check: "Triggers", text: "every fault case makes the allocations its test expects", details: [] };
}

/** A check that did not run, since one before it failed */
export function notRun(check: string, because: string): Line {
	return { status: "FAIL", check, text: `not run, since ${because}`, details: [] };
}

/**
 * The local files a C source includes with quotes, which the candidate must hold for the build
 *
 * ? Only the `#include "name"` form names a file of the release; the angle-bracket form names the C library
 */
export function includesOf(text: string): string[] {
	return [...text.matchAll(/^[ \t]*#[ \t]*include[ \t]+"([^"\n]+)"/gm)].map((match) => match[1] ?? "").filter((name) => name !== "");
}
