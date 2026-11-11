import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emccCommand, findPython } from "../scripts/emsdk.ts";

let emsdk = "";
beforeEach(() => {
	emsdk = mkdtempSync(join(tmpdir(), "arc-emsdk-"));
});

afterEach(() => {
	rmSync(emsdk, { recursive: true, force: true });
});

describe("findPython", () => {
	it("uses the Python on PATH on Windows before the SDK has installed its own", () => {
		expect(findPython(emsdk, "win32")).toBe("python");
	});

	it("uses the SDK's own Python on Windows once it is installed", () => {
		mkdirSync(join(emsdk, "python", "3.13.3_64bit"), { recursive: true });
		writeFileSync(join(emsdk, "python", "3.13.3_64bit", "python.exe"), "");
		expect(findPython(emsdk, "win32")).toBe(join(emsdk, "python", "3.13.3_64bit", "python.exe"));
	});

	it("uses python3 on macOS and Linux", () => {
		expect(findPython(emsdk, "darwin")).toBe("python3");
		expect(findPython(emsdk, "linux")).toBe("python3");
	});
});

describe("emccCommand", () => {
	it("runs emcc.py from the SDK with the settings activation wrote", () => {
		expect(emccCommand(emsdk, "linux")).toEqual({
			command: "python3",
			args: [join(emsdk, "upstream", "emscripten", "emcc.py")],
			env: { EM_CONFIG: join(emsdk, ".emscripten") },
		});
	});
});
