import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { TrackedFile } from "./names.ts";
import { findNames } from "./names.ts";

/**
 * Git treats a file as binary when its first 8000 bytes hold a NUL byte, and so does this check
 *
 * @see https://github.com/git/git/blob/v2.49.0/xdiff-interface.c#L196-L202
 */
const BINARY_PROBE = 8000;

function read(path: string): TrackedFile {
	const bytes = readFileSync(path);
	return { path, text: bytes.subarray(0, BINARY_PROBE).includes(0) ? undefined : bytes.toString("utf8") };
}

// ? A tracked file deleted from the working tree has nothing left to check
// eslint-disable-next-line sonarjs/no-os-command-from-path -- the gate runs on a devs machine, where git comes from PATH
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
	.split("\0")
	.filter((path) => path !== "" && existsSync(path));

const findings = findNames(paths.map(read));
for (const finding of findings) {
	const where = finding.line === undefined ? finding.path : `${finding.path}:${String(finding.line)}`;
	process.stderr.write(`${where} names ${finding.name}\n`);
}
const count = findings.length === 1 ? "1 finding" : `${String(findings.length)} findings`;
process.stdout.write(`Checked ${String(paths.length)} tracked files, ${count}\n`);
process.exitCode = findings.length === 0 ? 0 : 1;
