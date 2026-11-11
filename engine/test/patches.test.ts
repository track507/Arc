import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PATCHES } from "../patches/index.ts";
import type { Patch } from "../scripts/patches.ts";
import { applyPatches, fitOf, PatchError, readFiles } from "../scripts/patches.ts";

const QUICKJS = fileURLToPath(new URL("../quickjs/", import.meta.url));
const release = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8")) as { readonly files: Readonly<Record<string, string>> };
const RELEASE = readFiles(QUICKJS, Object.keys(release.files));

function patch(name: string, ...edits: Array<[file: string, find: string, replace: string]>): Patch {
	return { name, why: "test", source: { kind: "arc", answers: [] }, edits: edits.map(([file, find, replace]) => ({ file, find, replace })) };
}

function thrown(action: () => unknown): unknown {
	try {
		action();
	} catch (error) {
		return error;
	}
	return undefined;
}

const FILES = new Map([["a.c", "int a = 1;\nint b = 2;\nint b2 = 2;\n"]]);

describe("applyPatches", () => {
	it("replaces a find that occurs once", () => {
		expect(applyPatches(FILES, [patch("p", ["a.c", "a = 1", "a = 3"])]).get("a.c")).toBe("int a = 3;\nint b = 2;\nint b2 = 2;\n");
	});

	it("leaves the files it was given as they were", () => {
		applyPatches(FILES, [patch("p", ["a.c", "a = 1", "a = 3"])]);
		expect(FILES.get("a.c")).toBe("int a = 1;\nint b = 2;\nint b2 = 2;\n");
	});

	it("applies each edit to the text the edits before it left", () => {
		const patched = applyPatches(FILES, [patch("p", ["a.c", "a = 1", "a = 7"]), patch("q", ["a.c", "a = 7", "a = 9"])]);
		expect(patched.get("a.c")).toBe("int a = 9;\nint b = 2;\nint b2 = 2;\n");
	});

	it("writes a replace with a dollar sign as it is", () => {
		expect(applyPatches(FILES, [patch("p", ["a.c", "a = 1", "a = $&"])]).get("a.c")).toContain("a = $&;");
	});

	it("throws a PatchError naming the patch, the edit and the count when a find does not occur", () => {
		expect(() => applyPatches(FILES, [patch("p", ["a.c", "a = 1", "a = 3"], ["a.c", "c = 3", "c = 4"])])).toThrow(
			"p, edit 2 of 2: its find occurs 0 times in a.c"
		);
	});

	it("throws when a find occurs twice", () => {
		expect(() => applyPatches(FILES, [patch("p", ["a.c", " = 2;", " = 4;"])])).toThrow("p, edit 1 of 1: its find occurs 2 times in a.c");
	});

	it("throws when an edit names a file the release does not have", () => {
		expect(() => applyPatches(FILES, [patch("p", ["b.c", "a", "b"])])).toThrow("p, edit 1 of 1: b.c is not in the release");
	});

	it("gives the patch, the edit and the count as the error's cause", () => {
		const error = thrown(() => applyPatches(FILES, [patch("p", ["a.c", " = 2;", " = 4;"])]));
		expect(error).toBeInstanceOf(PatchError);
		expect((error as PatchError).cause).toEqual({ patch: "p", edit: 1, file: "a.c", count: 2 });
	});
});

describe("fitOf", () => {
	it("reads a patch whose finds each occur once as applying", () => {
		expect(fitOf(FILES, patch("p", ["a.c", "a = 1", "a = 3"]))).toEqual({ kind: "applies" });
	});

	it("reads a patch whose replaces each occur once as present", () => {
		expect(fitOf(FILES, patch("p", ["a.c", "a = 0", "a = 1"]))).toEqual({ kind: "present" });
	});

	it("reads an insertion as present once its text is there, though its find is inside it", () => {
		const insertion = patch("p", ["a.c", "int a = 1;\n", "int a = 1;\nint z = 0;\n"]);
		expect(fitOf(applyPatches(FILES, [insertion]), insertion)).toEqual({ kind: "present" });
	});

	it("names the first edit that no longer fits, and the count of its find", () => {
		expect(fitOf(FILES, patch("p", ["a.c", "a = 1", "a = 3"], ["a.c", " = 2;", " = 4;"]))).toEqual({
			kind: "misfit",
			edit: 2,
			file: "a.c",
			count: 2,
			partly: false,
		});
	});

	it("reads a patch with one edit present and another not as a misfit, partly present", () => {
		expect(fitOf(FILES, patch("p", ["a.c", "a = 0", "a = 1"], ["a.c", "c = 3", "c = 4"]))).toEqual({
			kind: "misfit",
			edit: 1,
			file: "a.c",
			count: 0,
			partly: true,
		});
	});
});

describe("the patch chain", () => {
	it("applies every patch to the vendored release, the chain's dry run", () => {
		expect(() => applyPatches(RELEASE, PATCHES)).not.toThrow();
	});

	it("reads every patch as present on the patched release", () => {
		const patched = applyPatches(RELEASE, PATCHES);
		expect(PATCHES.map((each) => [each.name, fitOf(patched, each).kind])).toEqual(PATCHES.map((each) => [each.name, "present"]));
	});

	it("numbers the patches from 01 in the order the index lists them", () => {
		expect(PATCHES.map((each) => each.name.slice(0, 3))).toEqual(PATCHES.map((_, index) => `${String(index + 1).padStart(2, "0")}-`));
	});

	it("names each patch as its file is named", () => {
		for (const each of PATCHES) expect(readFileSync(new URL(`../patches/${each.name}.ts`, import.meta.url), "utf8")).toContain(`name: "${each.name}"`);
	});

	it("changes something in every edit, and keeps every edit in ASCII", () => {
		for (const edit of PATCHES.flatMap((each) => each.edits)) {
			expect(edit.replace).not.toBe(edit.find);
			expect(/^[\t\n -~]*$/.test(edit.find + edit.replace)).toBe(true);
		}
	});
});
