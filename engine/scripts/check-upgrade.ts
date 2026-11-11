import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { PATCHES } from "../patches/index.ts";
import type { Release } from "./compile.ts";
import { buildEngines, DIST, EMSDK, ENGINE, readRelease, ROOT } from "./compile.ts";
import { applyPatches, readFiles } from "./patches.ts";
import { measure, readSizeRecord } from "./size.ts";
import type { Line, TestReport } from "./upgrade.ts";
import { durationOf, filesLine, format, includesOf, notRun, patchesLine, sizeLine, testsLine, timeLine, triggersLine, walkChain } from "./upgrade.ts";

// * pnpm engine:check-upgrade <candidate> [--emsdk <folder>]
// Reports whether a candidate engine, a release tarball or a folder holding a commit of Bellard's, takes Arc's patches, builds, passes the engine tests, and stays near the recorded size and speed
// ! It writes only below engine/dist/upgrade and changes no tracked file; switching the engine to a candidate is a manual step the README lists

const WORK = join(DIST, "upgrade");
const USAGE = "usage: pnpm engine:check-upgrade <candidate .tar.xz, .tar.gz or folder> [--emsdk <folder>]\n";
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");
/** The engine tests that run on the candidate; the release, size and patch tests check engine/quickjs itself, which the checks above stand in for */
const ENGINE_TESTS = ["engine/test/engine.test.ts", "engine/test/faults.test.ts"];

function fail(message: string): never {
	process.stderr.write(`${message}\n${USAGE}`);
	process.exit(1);
}

const lines: Line[] = [];
function report(line: Line): void {
	lines.push(line);
	process.stdout.write(`${format(line)}\n`);
}

/** Orders names by code point, as engine/release.json lists its files */
function byCodePoint(a: string, b: string): number {
	if (a < b) return -1;
	return a > b ? 1 : 0;
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Extracts a tarball with the system's tar, which reads .tar.xz and .tar.gz on Windows 10 and later, macOS and Linux
 *
 * ? On Windows the tar on PATH can be Git's GNU tar, which reads C: in a path as a remote host, so the command names the system's own
 */
function extract(archive: string, into: string): void {
	const tar = process.platform === "win32" ? join(process.env["SystemRoot"] ?? "C:\\Windows", "System32", "tar.exe") : "tar";
	mkdirSync(into, { recursive: true });
	const result = spawnSync(tar, ["-xf", archive, "-C", into], { encoding: "utf8" });
	if (result.status !== 0) fail(`tar could not extract ${archive}: ${result.stderr || String(result.error)}`);
}

/** The folder holding the candidate's files: the folder given, or a tarball's one top folder once extracted */
function locate(candidate: string): string {
	if (!existsSync(candidate)) fail(`${candidate} does not exist`);
	if (statSync(candidate).isDirectory()) return candidate;
	if (!/\.(tar\.xz|tar\.gz|tgz)$/.test(candidate)) fail(`${candidate} is not a .tar.xz or .tar.gz tarball or a folder`);
	const into = join(WORK, "candidate");
	rmSync(into, { recursive: true, force: true });
	extract(candidate, into);
	const entries = readdirSync(into);
	const only = entries[0];
	return entries.length === 1 && only !== undefined && statSync(join(into, only)).isDirectory() ? join(into, only) : into;
}

/** Runs the engine tests on a folder of builds, and returns Vitest's JSON report of them */
function runTests(folder: string, name: string): TestReport | undefined {
	const out = join(WORK, `${name}.json`);
	rmSync(out, { force: true });
	spawnSync(process.execPath, [VITEST, "run", ...ENGINE_TESTS, "--reporter=json", `--outputFile=${out}`], {
		cwd: ROOT,
		env: { ...process.env, ARC_ENGINE_DIST: folder },
		stdio: ["ignore", "ignore", "inherit"],
	});
	return existsSync(out) ? (JSON.parse(readFileSync(out, "utf8")) as TestReport) : undefined;
}

const [argument, flag, emsdkArgument] = process.argv.slice(2);
if (argument === undefined) fail("no candidate given");
if (flag !== undefined && (flag !== "--emsdk" || emsdkArgument === undefined)) fail(`unknown option ${flag}`);
const here = process.env["INIT_CWD"] ?? process.cwd();
const candidate = resolve(here, argument);
const emsdk = emsdkArgument === undefined ? EMSDK : resolve(here, emsdkArgument);
mkdirSync(WORK, { recursive: true });
const folder = locate(candidate);
const release = readRelease();
process.stdout.write(`candidate: ${folder}\n`);

// * Files
const recorded = Object.keys(release.files);
const has = (name: string): boolean => existsSync(join(folder, name)) && statSync(join(folder, name)).isFile();
const included = new Set(
	recorded.filter((name) => /\.[ch]$/.test(name) && has(name)).flatMap((name) => includesOf(readFileSync(join(folder, name), "latin1")))
);
const kept = [...new Set([...recorded, ...included])].filter(has).sort(byCodePoint);
const present = new Set(kept);
const version = has("VERSION") ? readFileSync(join(folder, "VERSION"), "utf8").trim() : "";
const archive = statSync(candidate).isFile();
const fresh: Release = {
	name: release.name,
	version,
	url: archive && /^quickjs-\d{4}-\d{2}-\d{2}\.tar\.xz$/.test(basename(candidate)) ? `https://bellard.org/quickjs/${basename(candidate)}` : "",
	sha256: archive ? sha256(candidate) : "",
	files: Object.fromEntries(kept.map((name) => [name, sha256(join(folder, name))])),
};
writeFileSync(join(WORK, "release.json"), `${JSON.stringify(fresh, null, "\t")}\n`);
report(filesLine(recorded, present, included, "engine/dist/upgrade/release.json"));

if (lines.some((line) => line.status === "FAIL")) {
	for (const check of ["Patches", "Build", "Tests", "Triggers", "Size", "Time"]) report(notRun(check, "the files check failed"));
} else {
	// * Patches
	const chain = walkChain(readFiles(folder, kept), PATCHES);
	report(patchesLine(chain));

	// * Build
	const applied = chain.fits.filter(({ fit }) => fit.kind === "applies");
	const left = chain.fits
		.filter(({ fit }) => fit.kind !== "applies")
		.map(({ patch, fit }) => `left out ${patch.name}, ${fit.kind === "present" ? "already in the candidate" : "which no longer fits"}`);
	const build = join(WORK, "build");
	let built = false;
	try {
		const result = await buildEngines({ emsdk, folder: build, files: chain.files, version });
		built = true;
		report({
			status: "PASS",
			check: "Build",
			text: `built the candidate with ${String(applied.length)} patches: arc-engine.wasm ${String(result.product.bytes)} bytes and the fault build ${String(result.fault.bytes)}`,
			details: left,
		});
	} catch (error) {
		// ? emcc prints its own errors as it runs, and its command line, which the error's message carries, runs to hundreds of characters
		const reason = error instanceof Error && error.message.startsWith("emcc ") ? "emcc failed, and its errors are above" : String(error);
		report({ status: "FAIL", check: "Build", text: `the candidate does not build with ${String(applied.length)} patches: ${reason}`, details: left });
	}

	if (!built) for (const check of ["Tests", "Triggers", "Size", "Time"]) report(notRun(check, "the build failed"));
	else {
		// * Tests and triggers
		const tested = runTests(build, "tests-candidate");
		if (tested === undefined) for (const check of ["Tests", "Triggers"]) report(notRun(check, "Vitest wrote no report"));
		else {
			report(testsLine(tested));
			report(triggersLine(tested));
		}

		// * Size
		report(sizeLine(measure(build), readSizeRecord()));

		// * Time
		// ? The pinned build runs the same tests in the same command, so the two times come from the same machine under the same load
		const files = applyPatches(readFiles(join(ENGINE, "quickjs"), recorded), PATCHES);
		await buildEngines({ emsdk: EMSDK, folder: DIST, files, version: release.version });
		const pinned = runTests(DIST, "tests-pinned");
		if (tested === undefined || pinned === undefined) report(notRun("Time", "Vitest wrote no report"));
		else report(timeLine(durationOf(tested), durationOf(pinned)));
	}
}

const failed = lines.filter((line) => line.status === "FAIL").length;
const counted = `${String(failed)} of ${String(lines.length)} checks failed`;
process.stdout.write(`${failed === 0 ? "the candidate passes every check" : counted}; no tracked file changed\n`);
process.exitCode = failed === 0 ? 0 : 1;
