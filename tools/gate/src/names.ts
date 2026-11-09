// A tracked file as the names check reads it, with no text for a binary file
export interface TrackedFile {
	readonly path: string;
	readonly text: string | undefined;
}

// One place a tracked file names something the repository keeps out, with no line when the name is in the path
export interface Finding {
	readonly path: string;
	readonly line: number | undefined;
	readonly name: string;
}

interface KeptOut {
	readonly name: string;
	readonly pattern: RegExp;
	readonly allowedIn: ReadonlySet<string>;
}

// ! Each pattern is joined from two strings, so this file never holds the names it rejects
const KEPT_OUT: readonly KeptOut[] = [
	{ name: "the notes folder", pattern: new RegExp("docs/" + "superpowers", "i"), allowedIn: new Set([".gitignore", "CLAUDE.md"]) },
	{ name: "the scratch folder", pattern: new RegExp("_scr" + "atch", "i"), allowedIn: new Set() },
	{ name: "the sheet's short name", pattern: new RegExp("mp" + "mb", "i"), allowedIn: new Set() },
];

/**
 * Finds every place the files name the notes folder, the scratch folder or the sheets short name
 *
 * The root .gitignore keeps the notes folder out and the root CLAUDE.md explains it, so both may name it
 */
export function findNames(files: Iterable<TrackedFile>): Finding[] {
	const findings: Finding[] = [];
	for (const file of files) {
		const kept = KEPT_OUT.filter((entry) => !entry.allowedIn.has(file.path));
		for (const entry of kept) {
			if (entry.pattern.test(file.path)) {
				findings.push({ path: file.path, line: undefined, name: entry.name });
			}
		}
		if (file.text === undefined) {
			continue;
		}
		file.text.split("\n").forEach((text, index) => {
			for (const entry of kept) {
				if (entry.pattern.test(text)) {
					findings.push({ path: file.path, line: index + 1, name: entry.name });
				}
			}
		});
	}
	return findings;
}
