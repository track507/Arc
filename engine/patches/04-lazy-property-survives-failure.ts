import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's 5febaaa: a lazily made built-in stays lazy until making it works
 *
 * Built-ins such as JSON.parse are made the first time a script reads them, so a run that fails there breaks every later run in the instance
 * Bellard's issue #580 reports it; Arc's fault build reaches it on typeof JSON.parse
 * @see https://github.com/bellard/quickjs/commit/5febaaa49f4558b93bd637b1bea7473db5a2880e
 * @see https://github.com/bellard/quickjs/issues/580
 */
const patch: Patch = {
	name: "04-lazy-property-survives-failure",
	why: "JS_AutoInitProperty clears a lazily made built-in before it checks that making it worked, so one failed allocation leaves the built-in undefined for the context's life",
	source: { kind: "upstream", project: "bellard", commit: "5febaaa49f4558b93bd637b1bea7473db5a2880e" },
	edits: [
		// Keeps the lazy property in place until its value exists
		{
			file: "quickjs.c",
			find: String.raw`    func = js_autoinit_func_table[id];
    /* 'func' shall not modify the object properties 'pr' */
    val = func(realm, p, prop, pr->u.init.opaque);
    js_autoinit_free(ctx->rt, pr);
    prs->flags &= ~JS_PROP_TMASK;
    pr->u.value = JS_UNDEFINED;
    if (JS_IsException(val))
        return -1;
    if (id == JS_AUTOINIT_ID_MODULE_NS &&
        JS_VALUE_GET_TAG(val) == JS_TAG_STRING) {
        /* WARNING: a varref is returned as a string  ! */
        prs->flags |= JS_PROP_VARREF;
        pr->u.var_ref = JS_VALUE_GET_PTR(val);
        js_rc(pr->u.var_ref)->ref_count++;
`,
			replace: String.raw`    func = js_autoinit_func_table[id];
    /* 'func' shall not modify the object properties 'pr' */
    val = func(realm, p, prop, pr->u.init.opaque);
    if (JS_IsException(val))
        return -1;
    if (id == JS_AUTOINIT_ID_MODULE_NS &&
        JS_VALUE_GET_TAG(val) == JS_TAG_STRING) {
        /* WARNING: a varref is returned as a string  ! */
        js_autoinit_free(ctx->rt, pr);
        prs->flags &= ~JS_PROP_TMASK;
        prs->flags |= JS_PROP_VARREF;
        pr->u.var_ref = JS_VALUE_GET_PTR(val);
        js_rc(pr->u.var_ref)->ref_count++;
`,
		},
		// Clears the lazy property only once its value is stored, and frees the value when the variable reference cannot be made
		{
			file: "quickjs.c",
			find: String.raw`        JSVarRef *var_ref;
        /* in the global object we use references */
        var_ref = js_create_var_ref(ctx, FALSE);
        if (!var_ref)
            return -1;
        prs->flags |= JS_PROP_VARREF;
        pr->u.var_ref = var_ref;
        var_ref->value = val; 
        var_ref->is_const = !(prs->flags & JS_PROP_WRITABLE);
    } else {
        pr->u.value = val;
    }
    return 0;
`,
			replace: String.raw`        JSVarRef *var_ref;
        /* in the global object we use references */
        var_ref = js_create_var_ref(ctx, FALSE);
        if (!var_ref) {
            JS_FreeValue(ctx, val);
            return -1;
        }
        js_autoinit_free(ctx->rt, pr);
        prs->flags &= ~JS_PROP_TMASK;
        prs->flags |= JS_PROP_VARREF;
        pr->u.var_ref = var_ref;
        var_ref->value = val; 
        var_ref->is_const = !(prs->flags & JS_PROP_WRITABLE);
    } else {
        js_autoinit_free(ctx->rt, pr);
        prs->flags &= ~JS_PROP_TMASK;
        pr->u.value = JS_UNDEFINED;
        pr->u.value = val;
    }
    return 0;
`,
		},
		// Frees the value being set when the lazy property it would replace cannot be made
		{
			file: "quickjs.c",
			find: String.raw`                return call_setter(ctx, pr->u.getset.setter, this_obj, val, flags);
            } else if ((prs->flags & JS_PROP_TMASK) == JS_PROP_AUTOINIT) {
                /* Instantiate property and retry (potentially useless) */
                if (JS_AutoInitProperty(ctx, p1, prop, pr, prs))
                    return -1;
                goto retry2;
            } else if (!(prs->flags & JS_PROP_WRITABLE)) {
                goto read_only_prop;
`,
			replace: String.raw`                return call_setter(ctx, pr->u.getset.setter, this_obj, val, flags);
            } else if ((prs->flags & JS_PROP_TMASK) == JS_PROP_AUTOINIT) {
                /* Instantiate property and retry (potentially useless) */
                if (JS_AutoInitProperty(ctx, p1, prop, pr, prs)) {
                    JS_FreeValue(ctx, val);
                    return -1;
                }
                goto retry2;
            } else if (!(prs->flags & JS_PROP_WRITABLE)) {
                goto read_only_prop;
`,
		},
	],
};

export default patch;
