import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { emccCommand } from "./emsdk.ts";
import type { Files } from "./patches.ts";

// * How the engine is compiled
// We gotta compile the compiler that compiles the compiler that compilers the compiler...
// Every build compiles a copy of the release with the patches applied, never engine/quickjs itself

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const ENGINE = join(ROOT, "engine");
/** The pinned Emscripten SDK that pnpm setup:engine fetches */
export const EMSDK = join(ROOT, ".emsdk");
/** The one gitignored output folder: the patched copy, the product build and the fault build */
export const DIST = join(ENGINE, "dist");

/** The release's library files Arc compiles, by name without .c */
const LIBRARY = ["quickjs", "libregexp", "libunicode", "cutils", "dtoa"];
const ENTRY = join(ENGINE, "src", "arc-engine.c");

// ? some native paths like JSON.stringify on nested arrays use little shadow stack but a lot of the host's, and at 44 KB that blew a Chromium Worker's stack before the check fired
// ? a sheet's session needs 10 to 12 KB, so 32 KB gives it room and stays under every host measured
const STACK_LIMIT = 32 * 1024; // the engine's stack limit in bytes of the shadow stack
// ? the biggest single frame in the engine is under 1 KB, so a run can't jump from above the limit to past the bottom
const STACK_SIZE = 8 * STACK_LIMIT; // shadow stack's size in bytes, 8 x the limit so the check fires before the stack's bottom

/** A kind of build: the flags it adds and the C entry points it exports */
export interface Flavor {
	readonly name: string;
	readonly defines: readonly string[];
	readonly exports: readonly string[];
}

const ENTRY_POINTS = ["_arc_start", "_arc_input", "_arc_run", "_arc_output", "_arc_output_length"];

/** The engine Arc ships */
export const PRODUCT: Flavor = { name: "product", defines: [], exports: ENTRY_POINTS };

/**
 * The engine the fault tests run on, which never ships
 *
 * ? __SANITIZE_ADDRESS__ is the release's own switch that sends every allocation to Arc's allocator instead of the release's small-block arenas, and no sanitizer runs
 * ? So the hook ARC_FAULTS compiles in sees every allocation, and the nth one is the same allocation on every run
 * ? quickjs/quickjs.c, JS_MALLOC_LARGE_BLOCKS_ONLY
 */
export const FAULT: Flavor = {
	name: "fault",
	defines: ["-D__SANITIZE_ADDRESS__", "-DARC_FAULTS"],
	exports: [...ENTRY_POINTS, "_arc_fail_at", "_arc_allocations", "_arc_live_blocks"],
};

function compileFlags(version: string, quickjs: string, flavor: Flavor): string[] {
	return [
		"-O2",
		"-D_GNU_SOURCE",
		"-DNDEBUG",
		`-DCONFIG_VERSION="${version}"`,
		// ! The release turns its stack check off under Emscripten, where it cannot see the host's stack, and without it JS_SetMaxStackSize does nothing
		"-DCONFIG_STACK_CHECK",
		`-DARC_STACK_LIMIT=${String(STACK_LIMIT)}`,
		...flavor.defines,
		`-I${quickjs}`,
	];
}

function linkFlags(flavor: Flavor): string[] {
	return [
		"-O2",
		"-sMODULARIZE",
		"-sEXPORT_ES6",
		"-sEXPORT_NAME=createArcEngine",
		"-sENVIRONMENT=node,worker",
		"-sALLOW_MEMORY_GROWTH",
		"-sINITIAL_MEMORY=32MB",
		"-sMAXIMUM_MEMORY=256MB",
		`-sSTACK_SIZE=${String(STACK_SIZE)}`,
		"-Wl,--stack-first", // ? puts the stack below the static data, so running off its bottom traps instead of writing over that data
		"-sFILESYSTEM=0",
		`-sEXPORTED_FUNCTIONS=${flavor.exports.join(",")}`,
		"-sEXPORTED_RUNTIME_METHODS=HEAPU8",
		"--no-entry",
	];
}

async function emcc(emsdk: string, args: readonly string[]): Promise<void> {
	const command = emccCommand(emsdk, process.platform);
	const child = spawn(command.command, [...command.args, ...args], { cwd: ROOT, env: { ...process.env, ...command.env }, stdio: "inherit" });
	const status = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	});
	if (status !== 0) throw new Error(`emcc ${args.join(" ")} failed`, { cause: { status } });
}

/**
 * Writes the patched files to a folder, which the build then compiles
 *
 * ? latin1 writes each character back as the byte readFiles read it from
 */
export function writeFiles(files: Files, folder: string): void {
	mkdirSync(folder, { recursive: true });
	for (const [name, text] of files) writeFileSync(join(folder, name), text, "latin1");
}

/** What one build needs: the SDK, the patched copy it compiles, the folder it writes and the kind of build */
export interface Build {
	readonly emsdk: string;
	readonly quickjs: string;
	readonly out: string;
	readonly flavor: Flavor;
	readonly version: string;
}

/** Hashes everything a build reads, so a build whose inputs have not changed is skipped */
function stamp(build: Build, files: Files): string {
	const hash = createHash("sha256");
	hash.update(JSON.stringify({ compile: compileFlags(build.version, "", build.flavor), link: linkFlags(build.flavor) }));
	hash.update(readFileSync(join(build.emsdk, "upstream", "emscripten", "emscripten-version.txt")));
	for (const name of [...files.keys()].sort((a, b) => a.localeCompare(b))) hash.update(name).update(files.get(name) ?? "", "latin1");
	hash.update(readFileSync(ENTRY));
	return hash.digest("hex");
}

/** The outcome of a build: whether it ran, the wasm's size and how long it took */
export interface Built {
	readonly ran: boolean;
	readonly bytes: number;
	readonly seconds: number;
}

/**
 * Compiles the patched copy into `out`, as arc-engine.mjs and arc-engine.wasm, unless the stamp in `out` says nothing it reads has changed
 *
 * @param files - the patched files, which must already be written to `build.quickjs`
 */
export async function compile(build: Build, files: Files): Promise<Built> {
	if (!existsSync(join(build.emsdk, ".emscripten")))
		throw new Error(`The Emscripten SDK is not in ${build.emsdk}; run pnpm setup:engine first`, { cause: { emsdk: build.emsdk } });
	const inputs = stamp(build, files);
	const stampFile = join(build.out, "build.json");
	const wasm = join(build.out, "arc-engine.wasm");
	if (existsSync(stampFile) && existsSync(wasm) && (JSON.parse(readFileSync(stampFile, "utf8")) as { readonly inputs: string }).inputs === inputs)
		return { ran: false, bytes: statSync(wasm).size, seconds: 0 };
	const started = performance.now();
	const objects = join(build.out, "obj");
	mkdirSync(objects, { recursive: true });
	const sources = [...LIBRARY.map((name) => join(build.quickjs, `${name}.c`)), ENTRY];
	const object = (source: string): string => join(objects, `${basename(source, ".c")}.o`);
	const compileArgs = compileFlags(build.version, build.quickjs, build.flavor);
	await Promise.all(sources.map(async (source) => emcc(build.emsdk, ["-c", ...compileArgs, source, "-o", object(source)])));
	await emcc(build.emsdk, [...linkFlags(build.flavor), ...sources.map(object), "-o", join(build.out, "arc-engine.mjs")]);
	writeFileSync(stampFile, `${JSON.stringify({ inputs }, null, "\t")}\n`);
	return { ran: true, bytes: statSync(wasm).size, seconds: (performance.now() - started) / 1000 };
}

/** What a pair of builds needs: the SDK, the folder the builds go to, the patched files and the release's version */
export interface Engines {
	readonly emsdk: string;
	readonly folder: string;
	readonly files: Files;
	readonly version: string;
}

/**
 * Writes the patched files to `folder`/quickjs and builds the product into `folder` and the fault build into `folder`/fault, side by side
 *
 * ? That is the layout distFolder in drive.ts reads, so the engine's tests run on any such folder
 */
export async function buildEngines(engines: Engines): Promise<{ readonly product: Built; readonly fault: Built }> {
	const quickjs = join(engines.folder, "quickjs");
	writeFiles(engines.files, quickjs);
	const build = async (out: string, flavor: Flavor): Promise<Built> =>
		compile({ emsdk: engines.emsdk, quickjs, out, flavor, version: engines.version }, engines.files);
	const [product, fault] = await Promise.all([build(engines.folder, PRODUCT), build(join(engines.folder, "fault"), FAULT)]);
	return { product, fault };
}

/** The vendored release's record, which names its version and every file Arc keeps */
export interface Release {
	readonly name: string;
	readonly version: string;
	readonly url: string;
	readonly sha256: string;
	readonly files: Readonly<Record<string, string>>;
}

/** Reads engine/release.json */
export function readRelease(): Release {
	return JSON.parse(readFileSync(join(ENGINE, "release.json"), "utf8")) as Release;
}
