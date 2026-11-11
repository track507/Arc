import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's cd97c2b: build_backtrace holds its own reference to the error it decorates
 *
 * Callers pass the runtime's current exception, and an out of memory raised while the trace is built replaces that exception and frees the old one
 * Bellard's issue #529 reports it; Arc's fault build reaches it on null.x when the last allocation, the stack string, fails
 * @see https://github.com/bellard/quickjs/commit/cd97c2b4a85a0cbd3bf3a56681c2d2c92f4bda68
 * @see https://github.com/bellard/quickjs/issues/529
 */
const patch: Patch = {
	name: "01-backtrace-holds-its-error",
	why: "build_backtrace uses the current exception after an allocation failure inside it frees it, so a stack trace that runs out of memory reads a freed block",
	source: { kind: "upstream", project: "bellard", commit: "cd97c2b4a85a0cbd3bf3a56681c2d2c92f4bda68" },
	edits: [
		// Takes a reference of its own to the error, so an out of memory raised below cannot free it
		{
			file: "quickjs.c",
			find: String.raw`/* if filename != NULL, an additional level is added with the filename
   and line number information (used for parse error). */
static void build_backtrace(JSContext *ctx, JSValueConst error_obj,
                            const char *filename, int line_num, int col_num,
                            int backtrace_flags)
{
    JSStackFrame *sf;
    JSValue str;
    DynBuf dbuf;
    const char *func_name_str;
    const char *str1;
    JSObject *p;

    if (!JS_IsObject(error_obj))
        return; /* protection in the out of memory case */
    
    js_dbuf_init(ctx, &dbuf);
    if (filename) {
`,
			replace: String.raw`/* if filename != NULL, an additional level is added with the filename
   and line number information (used for parse error). */
static void build_backtrace(JSContext *ctx, JSValueConst error_val,
                            const char *filename, int line_num, int col_num,
                            int backtrace_flags)
{
    JSStackFrame *sf;
    JSValue str, error_obj;
    DynBuf dbuf;
    const char *func_name_str;
    const char *str1;
    JSObject *p;

    if (!JS_IsObject(error_val))
        return; /* protection in the out of memory case */

    /* hold a reference: the allocations below can raise an out of memory,
       which frees the current exception, aliased by error_obj in the call
       sites passing rt->current_exception */
    error_obj = JS_DupValue(ctx, error_val);
    
    js_dbuf_init(ctx, &dbuf);
    if (filename) {
`,
		},
		// Leaves through the release of that reference when the file name cannot be made
		{
			file: "quickjs.c",
			find: String.raw`        dbuf_putc(&dbuf, '\n');
        str = JS_NewString(ctx, filename);
        if (JS_IsException(str))
            return;
        /* Note: SpiderMonkey does that, could update once there is a standard */
        if (JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_fileName, str,
                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0 ||
`,
			replace: String.raw`        dbuf_putc(&dbuf, '\n');
        str = JS_NewString(ctx, filename);
        if (JS_IsException(str))
            goto done;
        /* Note: SpiderMonkey does that, could update once there is a standard */
        if (JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_fileName, str,
                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0 ||
`,
		},
		// Leaves the same way when the file name or the position cannot be defined
		{
			file: "quickjs.c",
			find: String.raw`                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0 ||
            JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_columnNumber, JS_NewInt32(ctx, col_num),
                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0) {
            return;
        }
    }
    for(sf = ctx->rt->current_stack_frame; sf != NULL; sf = sf->prev_frame) {
`,
			replace: String.raw`                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0 ||
            JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_columnNumber, JS_NewInt32(ctx, col_num),
                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0) {
            goto done;
        }
    }
    for(sf = ctx->rt->current_stack_frame; sf != NULL; sf = sf->prev_frame) {
`,
		},
		// Releases the reference on the way out
		{
			file: "quickjs.c",
			find: String.raw`    dbuf_free(&dbuf);
    JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_stack, str,
                           JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
}

/* Note: it is important that no exception is returned by this function */
`,
			replace: String.raw`    dbuf_free(&dbuf);
    JS_DefinePropertyValue(ctx, error_obj, JS_ATOM_stack, str,
                           JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
 done:
    JS_FreeValue(ctx, error_obj);
}

/* Note: it is important that no exception is returned by this function */
`,
		},
	],
};

export default patch;
