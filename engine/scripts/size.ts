import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

import { ENGINE } from "./compile.ts";

// * The engine's size, measured as what a page downloads: bytes, and bytes after brotli at quality 11

/** A file's size in bytes, plain and brotli-compressed at quality 11 */
export interface Measure {
	readonly bytes: number;
	readonly brotli: number;
}

/** The product build's two files, as engine/size.json records them */
export interface SizeRecord {
	readonly wasm: Measure;
	readonly loader: Measure;
}

/** Where the record lives */
export const SIZE_RECORD = join(ENGINE, "size.json");

function measureFile(path: string): Measure {
	const bytes = readFileSync(path);
	const brotli = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
	return { bytes: bytes.length, brotli: brotli.length };
}

/** Measures the product build in a folder of builds */
export function measure(folder: string): SizeRecord {
	return { wasm: measureFile(join(folder, "arc-engine.wasm")), loader: measureFile(join(folder, "arc-engine.mjs")) };
}

/** Reads engine/size.json */
export function readSizeRecord(): SizeRecord {
	return JSON.parse(readFileSync(SIZE_RECORD, "utf8")) as SizeRecord;
}
