import { readFileSync } from "node:fs";
import { join } from "node:path";

// * The patch chain
// The release in engine/quickjs stays as it shipped, and every change to it is a patch applied to a copy
// A patch is a list of edits, each replacing text that occurs exactly once, so an edit can never land in the wrong place unseen

/** One replacement in one file of the release: `find` occurs exactly once in the text the edits before it left, and becomes `replace` */
export interface Edit {
	readonly file: string;
	readonly find: string;
	readonly replace: string;
}

/** Where a patch's code comes from: a commit of Bellard's or quickjs-ng's, or Arc's own, with every upstream issue and advisory it answers */
export type Source =
	| { readonly kind: "upstream"; readonly project: "bellard" | "quickjs-ng"; readonly commit: string }
	| { readonly kind: "arc"; readonly answers: readonly string[] };

/** A named change to the release, which engine/patches/index.ts lists in the order the chain applies it */
export interface Patch {
	readonly name: string;
	readonly why: string;
	readonly source: Source;
	readonly edits: readonly Edit[];
}

/** The release's files by name, as text */
export type Files = ReadonlyMap<string, string>;

/** Raised when an edit's `find` does not occur exactly once, with the patch, the edit's number from 1 and the count as its cause */
export class PatchError extends Error {
	override readonly name = "PatchError";
}

/** How a patch stands against a candidate release */
export type Fit =
	| { readonly kind: "applies" }
	| { readonly kind: "present" }
	| { readonly kind: "misfit"; readonly edit: number; readonly file: string; readonly count: number; readonly partly: boolean };

/** How many times `part` occurs in `text`, counting overlaps */
export function occurrences(text: string, part: string): number {
	let count = 0;
	for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) count++;
	return count;
}

/**
 * Reads the named files of a release folder
 *
 * ? latin1 maps every byte to one character and back, so a file that is not UTF-8 is written out byte for byte, and the patches themselves are ASCII
 */
export function readFiles(folder: string, names: readonly string[]): Map<string, string> {
	return new Map(names.map((name) => [name, readFileSync(join(folder, name), "latin1")]));
}

/** Applies one edit to its file's text, and throws a PatchError naming the patch and the edit when its `find` does not occur exactly once */
function applyEdit(files: Map<string, string>, patch: Patch, index: number): void {
	const edit = patch.edits[index];
	if (edit === undefined) return;
	const text = files.get(edit.file);
	const count = text === undefined ? 0 : occurrences(text, edit.find);
	if (text === undefined || count !== 1) {
		const where = text === undefined ? `${edit.file} is not in the release` : `its find occurs ${String(count)} times in ${edit.file}`;
		throw new PatchError(`${patch.name}, edit ${String(index + 1)} of ${String(patch.edits.length)}: ${where}`, {
			cause: { patch: patch.name, edit: index + 1, file: edit.file, count },
		});
	}
	files.set(
		edit.file,
		text.replace(edit.find, () => edit.replace)
	);
}

/**
 * Applies the patches in order, each edit to the text the edits before it left, and returns the patched files
 *
 * @throws PatchError when an edit's `find` does not occur exactly once
 */
export function applyPatches(files: Files, patches: readonly Patch[]): Map<string, string> {
	const patched = new Map(files);
	for (const patch of patches) for (let index = 0; index < patch.edits.length; index++) applyEdit(patched, patch, index);
	return patched;
}

/**
 * Tells how a patch stands against a candidate's files: it applies, it is already present, or it no longer fits
 *
 * A patch is present when every edit's `replace` occurs once in the candidate, which is how a fix upstream took as written shows
 * Otherwise it applies when every edit's `find` occurs once and its `replace` does not, and a misfit names the first edit that fails either test
 * ? An edit that inserts text has its `find` inside its `replace`, so the present test runs first, and a patch only partly present is a misfit
 */
export function fitOf(files: Files, patch: Patch): Fit {
	const present = patch.edits.every((edit) => occurrences(files.get(edit.file) ?? "", edit.replace) === 1);
	if (present) return { kind: "present" };
	const trial = new Map(files);
	for (let index = 0; index < patch.edits.length; index++) {
		const edit = patch.edits[index];
		if (edit === undefined) continue;
		const text = trial.get(edit.file) ?? "";
		const count = occurrences(text, edit.find);
		const partly = occurrences(text, edit.replace) !== 0;
		if (count !== 1 || partly) return { kind: "misfit", edit: index + 1, file: edit.file, count, partly };
		trial.set(
			edit.file,
			text.replace(edit.find, () => edit.replace)
		);
	}
	return { kind: "applies" };
}
