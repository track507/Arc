import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Release {
	readonly name: string;
	readonly version: string;
	readonly url: string;
	readonly sha256: string;
	readonly files: Readonly<Record<string, string>>;
}

const QUICKJS = new URL("../quickjs/", import.meta.url);
const release = JSON.parse(readFileSync(new URL("../release.json", import.meta.url), "utf8")) as Release;

function sha256(name: string): string {
	return createHash("sha256")
		.update(readFileSync(new URL(name, QUICKJS)))
		.digest("hex");
}

describe("the vendored QuickJS release", () => {
	it.each(Object.entries(release.files))("has %s as the release ships it", (name, hash) => {
		expect(sha256(name)).toBe(hash);
	});

	it("holds only the files the record lists", () => {
		expect(new Set(readdirSync(QUICKJS))).toEqual(new Set(Object.keys(release.files)));
	});

	it("is the version the record names", () => {
		expect(readFileSync(new URL("VERSION", QUICKJS), "utf8").trim()).toBe(release.version);
	});
});
