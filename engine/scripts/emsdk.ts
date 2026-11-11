import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The emsdk tag the engine is built with, which every measurement of the engine ran on */
export const EMSDK_VERSION = "6.0.13";
/** The commit the tag names, so a clone that moved to another commit is caught */
export const EMSDK_COMMIT = "35659964bc2762fffec0d257997fb61475f765b7";
export const EMSDK_REPOSITORY = "https://github.com/emscripten-core/emsdk.git";

export interface Command {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
}

/**
 * Finds the Python that runs the SDK's scripts
 *
 * On Windows the SDK installs its own Python, and until it has, the Python on PATH runs the installer
 * Elsewhere the SDK runs on python3 from PATH, as its own launcher does
 * @see https://github.com/emscripten-core/emsdk/blob/6.0.13/emsdk.bat
 */
export function findPython(emsdk: string, platform: NodeJS.Platform): string {
	if (platform !== "win32") return "python3";
	const folder = join(emsdk, "python");
	if (!existsSync(folder)) return "python";
	const bundled = readdirSync(folder)
		.map((version) => join(folder, version, "python.exe"))
		.find((path) => existsSync(path));
	return bundled ?? "python";
}

/**
 * The command that runs the SDK's emcc, with no shell and no change to PATH
 *
 * ? Activation writes the SDK's settings to .emscripten in its root, and EM_CONFIG points emcc at them
 */
export function emccCommand(emsdk: string, platform: NodeJS.Platform): Command {
	return {
		command: findPython(emsdk, platform),
		args: [join(emsdk, "upstream", "emscripten", "emcc.py")],
		env: { EM_CONFIG: join(emsdk, ".emscripten") },
	};
}
