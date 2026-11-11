import { join } from "node:path";

import { PATCHES } from "../patches/index.ts";
import { buildEngines, DIST, EMSDK, ENGINE, readRelease } from "./compile.ts";
import { applyPatches, readFiles } from "./patches.ts";

// * Builds the engine Arc ships and the fault build its tests run on
// The release in engine/quickjs gets every patch in engine/patches, in memory, and the patched copy goes to engine/dist/quickjs for both builds to compile
// A build whose inputs have not changed is skipped

const release = readRelease();
const files = applyPatches(readFiles(join(ENGINE, "quickjs"), Object.keys(release.files)), PATCHES);
process.stdout.write(`engine: ${String(PATCHES.length)} patches applied to engine/dist/quickjs\n`);

const built = await buildEngines({ emsdk: EMSDK, folder: DIST, files, version: release.version });
for (const [label, result] of [
	["arc-engine.wasm", built.product],
	["fault/arc-engine.wasm", built.fault],
] as const) {
	if (result.ran) process.stdout.write(`engine: built ${label}, ${String(result.bytes)} bytes, in ${result.seconds.toFixed(1)} s\n`);
	else process.stdout.write(`engine: ${label} up to date\n`);
}
