import { describe, expect, it } from "vitest";

import { findNames } from "../src/names.ts";

const NOTES = "docs/" + "superpowers";
const SCRATCH = "_scr" + "atch";
const SHORT_NAME = "MP" + "MB";

describe("findNames", () => {
	it("accepts files that name none of them", () => {
		expect(findNames([{ path: "README.md", text: "# Arc\n\nAn engine for fillable character sheets\n" }])).toEqual([]);
	});

	it("reports the notes folder in a file's text, with its line", () => {
		expect(findNames([{ path: "README.md", text: `# Arc\n\nSee ${NOTES}/plans\n` }])).toEqual([{ path: "README.md", line: 3, name: "the notes folder" }]);
	});

	it("allows the notes folder in the root .gitignore and CLAUDE.md only", () => {
		const text = `${NOTES}/\n`;
		expect(
			findNames([
				{ path: ".gitignore", text },
				{ path: "CLAUDE.md", text },
				{ path: "docs/CLAUDE.md", text },
			])
		).toEqual([{ path: "docs/CLAUDE.md", line: 1, name: "the notes folder" }]);
	});

	it("reports the scratch folder in every file, .gitignore included", () => {
		expect(findNames([{ path: ".gitignore", text: `${SCRATCH}/\n` }])).toEqual([{ path: ".gitignore", line: 1, name: "the scratch folder" }]);
	});

	it("reports the sheet's short name in any case", () => {
		const text = `const a = "${SHORT_NAME.toLowerCase()}";\nconst b = "${SHORT_NAME}";\n`;
		expect(findNames([{ path: "src/a.ts", text }])).toEqual([
			{ path: "src/a.ts", line: 1, name: "the sheet's short name" },
			{ path: "src/a.ts", line: 2, name: "the sheet's short name" },
		]);
	});

	it("reports a name in a file's path, with no line", () => {
		const path = `notes/${SCRATCH}/a.md`;
		expect(findNames([{ path, text: "" }])).toEqual([{ path, line: undefined, name: "the scratch folder" }]);
	});

	it("checks the path of a binary file but not its bytes", () => {
		const path = `fixtures/${SHORT_NAME}.pdf`;
		expect(
			findNames([
				{ path: "fixtures/a.pdf", text: undefined },
				{ path, text: undefined },
			])
		).toEqual([{ path, line: undefined, name: "the sheet's short name" }]);
	});

	it("reports each name on a line that holds two", () => {
		expect(findNames([{ path: "a.md", text: `${NOTES} and ${SCRATCH}\n` }])).toEqual([
			{ path: "a.md", line: 1, name: "the notes folder" },
			{ path: "a.md", line: 1, name: "the scratch folder" },
		]);
	});

	it("counts lines the same with Windows line endings", () => {
		expect(findNames([{ path: "a.md", text: `one\r\ntwo ${SCRATCH}\r\n` }])).toEqual([{ path: "a.md", line: 2, name: "the scratch folder" }]);
	});
});
