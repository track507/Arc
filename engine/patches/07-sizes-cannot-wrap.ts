import type { Patch } from "../scripts/patches.ts";

/**
 * Arc's own: a size that a script picks cannot wrap a 32-bit size_t
 *
 * A Proxy whose ownKeys trap claims 0x20000000 keys, or an array-like object with that length passed to toReversed, toSorted, toSpliced or with, makes a block of 0 bytes and writes past it
 * On a 64-bit build the same product asks for 4 GB and fails cleanly, so upstream's own tests do not show it
 * Bellard's issue #535 and quickjs-ng's advisory GHSA-jp52-chwg-2p9p report it, and no upstream commit fixes it yet
 * Bellard's open pull requests #556 and #566 check some of the same sites; this patch is written from the fault, not from them
 * @see https://github.com/bellard/quickjs/issues/535
 * @see https://github.com/quickjs-ng/quickjs/security/advisories/GHSA-jp52-chwg-2p9p
 */
const patch: Patch = {
	name: "07-sizes-cannot-wrap",
	why: "On wasm32 a size_t holds 32 bits, so a count that a script picks times an element size can wrap to a small block that the code then writes past",
	source: { kind: "arc", answers: ["https://github.com/bellard/quickjs/issues/535", "GHSA-jp52-chwg-2p9p"] },
	edits: [
		// Adds the largest size the allocator takes, so adding the alignment and a block header cannot wrap, and a checked product for counts
		{
			file: "quickjs.c",
			find: String.raw`/* end JS Malloc */
`,
			replace: String.raw`/* end JS Malloc */

/* Arc: the largest size the allocator takes, so adding the alignment and a block header cannot wrap a 32-bit size_t */
#define JS_MALLOC_MAX_SIZE (SIZE_MAX - JS_MALLOC_ALIGN - sizeof(JSMallocLargeBlockHeader))

/* Arc: whether count elements of elem_size bytes fit the allocator */
static inline BOOL js_malloc_array_ok(uint64_t count, size_t elem_size)
{
    return count <= JS_MALLOC_MAX_SIZE / elem_size;
}
`,
		},
		// Refuses a size whose header and alignment would wrap, which __js_malloc adds before it allocates
		{
			file: "quickjs.c",
			find: String.raw`static void *__js_malloc(JSMallocContext *s, size_t size)
{
    size_t total_size;
`,
			replace: String.raw`static void *__js_malloc(JSMallocContext *s, size_t size)
{
    size_t total_size;
    if (unlikely(size > JS_MALLOC_MAX_SIZE))
        return NULL;
`,
		},
		// Refuses the same sizes on a resize, where a wrapped total would hand back the old small block
		{
			file: "quickjs.c",
			find: String.raw`static void *__js_realloc(JSMallocContext *s, void *ptr, size_t size)
{
    JSMallocBlockHeader *b;
`,
			replace: String.raw`static void *__js_realloc(JSMallocContext *s, void *ptr, size_t size)
{
    JSMallocBlockHeader *b;
    if (unlikely(size > JS_MALLOC_MAX_SIZE))
        return NULL;
`,
		},
		// Sizes a growing fast array in 64 bits and throws out of memory past what the allocator takes, since a script picks the new length
		{
			file: "quickjs.c",
			find: String.raw`    uint32_t new_size;
    size_t slack;
    JSValue *new_array_prop;
    /* XXX: potential arithmetic overflow */
    new_size = max_int(new_len, p->u.array.u1.size * 3 / 2);
    new_array_prop = js_realloc2(ctx, p->u.array.u.values, sizeof(JSValue) * new_size, &slack);
`,
			replace: String.raw`    uint64_t new_size;
    size_t slack;
    JSValue *new_array_prop;
    /* Arc: sizeof(JSValue) * new_size wraps a 32-bit size_t, and a script picks new_len */
    new_size = max_int64(new_len, (uint64_t)p->u.array.u1.size * 3 / 2);
    if (new_size > UINT32_MAX || !js_malloc_array_ok(new_size, sizeof(JSValue))) {
        JS_ThrowOutOfMemory(ctx);
        return -1;
    }
    new_array_prop = js_realloc2(ctx, p->u.array.u.values, sizeof(JSValue) * (size_t)new_size, &slack);
`,
		},
		// Checks the length a Proxy's ownKeys trap claims before its table is allocated, and throws out of memory past what the allocator takes
		{
			file: "quickjs.c",
			find: String.raw`    if (len > 0) {
        tab = js_mallocz(ctx, sizeof(tab[0]) * len);
`,
			replace: String.raw`    if (len > 0) {
        /* Arc: a trap claims any length, and sizeof(tab[0]) * len wraps a 32-bit size_t */
        if (!js_malloc_array_ok(len, sizeof(tab[0]))) {
            JS_ThrowOutOfMemory(ctx);
            goto fail;
        }
        tab = js_mallocz(ctx, sizeof(tab[0]) * len);
`,
		},
		// Checks the own property count the same way, which the memory limit already bounds, so no test reaches it
		{
			file: "quickjs.c",
			find: String.raw`    if (atom_count < exotic_keys_count || atom_count > INT32_MAX) {
`,
			replace: String.raw`    if (atom_count < exotic_keys_count || atom_count > INT32_MAX ||
        !js_malloc_array_ok(max_int(atom_count, 1), sizeof(tab_atom[0]))) {
`,
		},
		// Checks a typed array sort's index table the same way, which the memory limit already bounds, so no test reaches it
		{
			file: "quickjs.c",
			find: String.raw`            /* the array must be copied because the comparison
               function may modify it */
            array = js_malloc(ctx, len * elt_size);
`,
			replace: String.raw`            if (!js_malloc_array_ok(len, sizeof(array_idx[0])))
                return JS_ThrowOutOfMemory(ctx);
            /* the array must be copied because the comparison
               function may modify it */
            array = js_malloc(ctx, len * elt_size);
`,
		},
	],
};

export default patch;
