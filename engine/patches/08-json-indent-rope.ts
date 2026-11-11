import type { Patch } from "../scripts/patches.ts";

/**
 * quickjs-ng's 35e195c9a: JSON.stringify flattens a rope indent before it reads it
 *
 * A rope holds two pointers where a flat string holds characters, so the output carried a tag and a memory offset of the engine's own
 * quickjs-ng's advisory GHSA-3jf7-4qfx-xc2h reports it, and Bellard's code has the same lines; JS_ToStringFree flattens a rope in the release too
 * The code is quickjs-ng's, under its MIT license, whose notice is engine/patches/LICENSE-quickjs-ng
 * @see https://github.com/quickjs-ng/quickjs/commit/35e195c9a04be740f779446c118553c901a5ec32
 * @see https://github.com/quickjs-ng/quickjs/security/advisories/GHSA-3jf7-4qfx-xc2h
 */
const patch: Patch = {
	name: "08-json-indent-rope",
	why: "JSON.stringify reads an indent built by joining two long strings, a rope, as if it were a flat string, and copies the rope's internal bytes into its output",
	source: { kind: "upstream", project: "quickjs-ng", commit: "35e195c9a04be740f779446c118553c901a5ec32" },
	edits: [
		// Flattens the indent before its characters are read, since a rope's characters are not in the string itself
		{
			file: "quickjs.c",
			find: String.raw`    } else if (JS_IsString(space)) {
        JSString *p = JS_VALUE_GET_STRING(space);
        jsc->gap = js_sub_string(ctx, p, 0, min_int(p->len, 10));
`,
			replace: String.raw`    } else if (JS_IsString(space)) {
        JSString *p;
        space = JS_ToStringFree(ctx, space);
        if (JS_IsException(space))
            goto exception;
        p = JS_VALUE_GET_STRING(space);
        jsc->gap = js_sub_string(ctx, p, 0, min_int(p->len, 10));
`,
		},
	],
};

export default patch;
