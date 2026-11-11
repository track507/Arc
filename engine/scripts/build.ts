import { spawn } from "child_process";
import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { basename, join } from "path";
import { fileURLToPath } from "url";
import { emccCommand } from "./emsdk.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const engine = join(root, "engine");
const emsdk = join(root, ".emsdk");
const dist = join(engine, "dist");
const objects = join(dist, "obj");

const release = JSON.parse(readFileSync(join(engine, "release.json"), "utf8")) as { readonly version: string };

// library files and the c entry point
const SOURCES = [
	...["quickjs", "libregexp", "libunicode", "cutils", "dtoa"].map((name) => join(engine, "quickjs", `${name}.c`)),
	join(engine, "src", "arc-engine.c"),
];
const COMPILE = ["-O2", "-D_GNU_SOURCE", "-DNDEBUG", `-DCONFIG_VERSION="${release.version}"`, `-I${join(engine, "quickjs")}`];
const EXPORTS = ["_arc_start", "_arc_input", "_arc_run", "_arc_output", "_arc_output_length"];
const LINK = [
	"-O2",
	"-sMODULARIZE",
	"-sEXPORT_ES6",
	"-sEXPORT_NAME=createArcEngine",
	"-sENVIRONMENT=node,worker",
	"-sALLOW_MEMORY_GROWTH",
	"-sINITIAL_MEMORY=32MB",
	"-sMAXIMUM_MEMORY=256MB",
	"-sSTACK_SIZE=4MB",
	"-sFILESYSTEM=0",
	`-sEXPORTED_FUNCTIONS=${EXPORTS.join(",")}`,
	"-sEXPORTED_RUNTIME_METHODS=HEAPU8",
	"--no-entry",
];

async function emcc(args: readonly string[]): Promise<void> {
	const command = emccCommand(emsdk, process.platform);
	const child = spawn(command.command, [...command.args, ...args], { cwd: root, env: { ...process.env, ...command.env }, stdio: "inherit" });
	const status = await new Promise<number | null>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", resolve);
	});
	if (status !== 0) throw new Error(`emcc ${args.join(" ")} failed`, { cause: { status } });
}

function stamp(): string {
	const hash = createHash("sha256");
	hash.update(JSON.stringify({ COMPILE, LINK }));
	hash.update(readFileSync(join(emsdk, "upstream", "emscripten", "emscripten-version.txt")));
	for (const folder of [join(engine, "quickjs"), join(engine, "src")])
		for (const name of readdirSync(folder).sort((a, b) => a.localeCompare(b))) hash.update(name).update(readFileSync(join(folder, name)));
	return hash.digest("hex");
}

if (!existsSync(join(emsdk, ".emscripten"))) throw new Error("The Emscripten SDK is not in .emsdk; run pnpm setup:engine first", { cause: { emsdk } });

const inputs = stamp();
const stampFile = join(dist, "build.json");
const wasm = join(dist, "arc-engine.wasm");
const built = existsSync(stampFile) && existsSync(wasm) && (JSON.parse(readFileSync(stampFile, "utf8")) as { readonly inputs: string }).inputs === inputs;

if (built) process.stdout.write("engine: up to date\n");
else {
	const started = performance.now();
	mkdirSync(objects, { recursive: true });
	await Promise.all(SOURCES.map(async (source) => emcc(["-c", ...COMPILE, source, "-o", join(objects, `${basename(source, ".c")}.o`)])));
	await emcc([...LINK, ...SOURCES.map((source) => join(objects, `${basename(source, ".c")}.o`)), "-o", join(dist, "arc-engine.mjs")]);
	writeFileSync(stampFile, `${JSON.stringify({ inputs }, null, "\t")}\n`);
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	process.stdout.write(`engine: built arc-engine.wasm, ${String(statSync(wasm).size)} bytes, in ${seconds} s\n`);
}
