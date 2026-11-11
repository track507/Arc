import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { EMSDK_COMMIT, EMSDK_REPOSITORY, EMSDK_VERSION, emccCommand, findPython } from "./emsdk.ts";

// * Fetches the pinned Emscripten SDK into .emsdk at the repository root, which .gitignore keeps out
// Deleting .emsdk undoes it, and a second run finds the SDK in place and changes nothing

const root = fileURLToPath(new URL("../../", import.meta.url));
const emsdk = join(root, ".emsdk");

/** Runs a program with its output shown, and throws when it fails */
function run(command: string, args: readonly string[]): void {
	const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
	if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`, { cause: { status: result.status, error: result.error } });
}

/** Runs a program and returns what it printed, and throws when it fails */
function read(command: string, args: readonly string[], env: Readonly<Record<string, string>> = {}): string {
	const result = spawnSync(command, args, { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
	if (result.status !== 0)
		throw new Error(`${command} ${args.join(" ")} failed`, { cause: { status: result.status, error: result.error, stderr: result.stderr } });
	return result.stdout;
}

if (!existsSync(join(emsdk, ".git"))) run("git", ["clone", "--depth", "1", "--branch", EMSDK_VERSION, EMSDK_REPOSITORY, emsdk]);

const head = read("git", ["-C", emsdk, "rev-parse", "HEAD"]).trim();
if (head !== EMSDK_COMMIT)
	throw new Error(`.emsdk holds ${head}, not emsdk ${EMSDK_VERSION}; delete .emsdk and run pnpm setup:engine again`, {
		cause: { head, expected: EMSDK_COMMIT },
	});

run(findPython(emsdk, process.platform), [join(emsdk, "emsdk.py"), "install", EMSDK_VERSION]);
run(findPython(emsdk, process.platform), [join(emsdk, "emsdk.py"), "activate", EMSDK_VERSION]);

const emcc = emccCommand(emsdk, process.platform);
process.stdout.write(`${read(emcc.command, [...emcc.args, "--version"], emcc.env).split("\n")[0] ?? ""}\n`);
