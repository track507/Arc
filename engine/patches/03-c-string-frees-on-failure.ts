import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's 552d5eb: JS_ToCStringLen2 frees the converted string when its buffer cannot be made
 *
 * Arc's engine calls it for every value and every error it writes out, so each failure there leaks one block for the instance's life
 * Bellard's issue #587 reports it; Arc's fault build reaches it on a string outside ASCII as a run's value
 * @see https://github.com/bellard/quickjs/commit/552d5ebaafdb0218429a4e96f7fad9eea4f9a23d
 * @see https://github.com/bellard/quickjs/issues/587
 */
const patch: Patch = {
	name: "03-c-string-frees-on-failure",
	why: "JS_ToCStringLen2 leaks the converted string when the buffer for its UTF-8 cannot be allocated",
	source: { kind: "upstream", project: "bellard", commit: "552d5ebaafdb0218429a4e96f7fad9eea4f9a23d" },
	edits: [
		// Frees the converted string on the failure path, as the success path does
		{
			file: "quickjs.c",
			find: String.raw`        *plen = str_new->len;
    return (const char *)str_new->u.str8;
 fail:
    if (plen)
        *plen = 0;
    return NULL;
`,
			replace: String.raw`        *plen = str_new->len;
    return (const char *)str_new->u.str8;
 fail:
    JS_FreeValue(ctx, val);
    if (plen)
        *plen = 0;
    return NULL;
`,
		},
	],
};

export default patch;
