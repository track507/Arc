import { writeFileSync } from "node:fs";

import { DIST } from "./compile.ts";
import { measure, SIZE_RECORD } from "./size.ts";

// * pnpm engine:record-size
// Writes the product build's size to engine/size.json, after pnpm build:engine, so the commit that changes the engine shows what the change costs

const record = measure(DIST);
writeFileSync(SIZE_RECORD, `${JSON.stringify(record, null, "\t")}\n`);
process.stdout.write(
	`engine: recorded arc-engine.wasm at ${String(record.wasm.bytes)} bytes, ${String(record.wasm.brotli)} with brotli, and arc-engine.mjs at ${String(record.loader.bytes)}, ${String(record.loader.brotli)}\n`
);
