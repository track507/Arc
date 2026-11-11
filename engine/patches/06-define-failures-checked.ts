import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's 0943061: a define borrows a value it does not own, and its failure is checked
 *
 * The commit adds JS_DefinePropertyValueC, which borrows its value where JS_DefinePropertyValue takes it, and moves callers that held a reference onto it
 * It also checks define results the release ignored, in bind, the Error constructors, property descriptors and others
 * Six of its hunks are left out: five change code the release does not have, the SuppressedError constructor, the stack setter, the SuppressedError that disposal makes, Promise.allKeyed and Atomics.wait's result
 * The sixth, in import attributes, changes lines the release writes another way, where it swaps a define for the borrowing one and fixes no fault
 * Arc's fault build reaches the double free on Promise.withResolvers
 * @see https://github.com/bellard/quickjs/commit/094306131aa57612dabbcb2c3028074259c969c1
 */
const patch: Patch = {
	name: "06-define-failures-checked",
	why: "Promise.withResolvers frees values that a failed define already freed, a double free, and other callers ignore a define that fails",
	source: { kind: "upstream", project: "bellard", commit: "094306131aa57612dabbcb2c3028074259c969c1" },
	edits: [
		// Adds JS_DefinePropertyValueC, a define that borrows its value, and builds JS_DefinePropertyValue on it
		{
			file: "quickjs.c",
			find: String.raw`}

/* shortcut to add or redefine a new property value */
int JS_DefinePropertyValue(JSContext *ctx, JSValueConst this_obj,
                           JSAtom prop, JSValue val, int flags)
{
    int ret;
    ret = JS_DefineProperty(ctx, this_obj, prop, val, JS_UNDEFINED, JS_UNDEFINED,
                            flags | JS_PROP_HAS_VALUE | JS_PROP_HAS_CONFIGURABLE | JS_PROP_HAS_WRITABLE | JS_PROP_HAS_ENUMERABLE);
    JS_FreeValue(ctx, val);
    return ret;
}
`,
			replace: String.raw`}

/* shortcut to add or redefine a new property value */
/* XXX: rename to JS_DefinePropertyValue ?  */
static int JS_DefinePropertyValueC(JSContext *ctx, JSValueConst this_obj,
                            JSAtom prop, JSValueConst  val, int flags)
{
    return JS_DefineProperty(ctx, this_obj, prop, val, JS_UNDEFINED, JS_UNDEFINED,
                            flags | JS_PROP_HAS_VALUE | JS_PROP_HAS_CONFIGURABLE | JS_PROP_HAS_WRITABLE | JS_PROP_HAS_ENUMERABLE);
}

/* shortcut to add or redefine a new property value */
/* XXX: rename to JS_DefinePropertyValueFree ?  */
int JS_DefinePropertyValue(JSContext *ctx, JSValueConst this_obj,
                           JSAtom prop, JSValue val, int flags)
{
    int ret;
    ret = JS_DefinePropertyValueC(ctx, this_obj, prop, val, flags);
    JS_FreeValue(ctx, val);
    return ret;
}
`,
		},
		// Defines a prototype's constructor with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`        return JS_EXCEPTION;
    set_cycle_flag(ctx, obj);
    set_cycle_flag(ctx, this_val);
    ret = JS_DefinePropertyValue(ctx, obj, JS_ATOM_constructor,
                                 JS_DupValue(ctx, this_val),
                                 JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    if (ret < 0) {
        JS_FreeValue(ctx, obj);
        return JS_EXCEPTION;
`,
			replace: String.raw`        return JS_EXCEPTION;
    set_cycle_flag(ctx, obj);
    set_cycle_flag(ctx, this_val);
    ret = JS_DefinePropertyValueC(ctx, obj, JS_ATOM_constructor,
                                  this_val,
                                  JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    if (ret < 0) {
        JS_FreeValue(ctx, obj);
        return JS_EXCEPTION;
`,
		},
		// Defines a class's constructor and prototype with borrowed values
		{
			file: "quickjs.c",
			find: String.raw`    /* the constructor property must be first. It can be overriden by
       computed property names */
    if (JS_DefinePropertyValue(ctx, proto, JS_ATOM_constructor,
                               JS_DupValue(ctx, ctor),
                               JS_PROP_CONFIGURABLE |
                               JS_PROP_WRITABLE | JS_PROP_THROW) < 0)
        goto fail;
    /* set the prototype property */
    if (JS_DefinePropertyValue(ctx, ctor, JS_ATOM_prototype,
                               JS_DupValue(ctx, proto), JS_PROP_THROW) < 0)
        goto fail;
    set_cycle_flag(ctx, ctor);
    set_cycle_flag(ctx, proto);
`,
			replace: String.raw`    /* the constructor property must be first. It can be overriden by
       computed property names */
    if (JS_DefinePropertyValueC(ctx, proto, JS_ATOM_constructor,
                                ctor,
                                JS_PROP_CONFIGURABLE |
                                JS_PROP_WRITABLE | JS_PROP_THROW) < 0)
        goto fail;
    /* set the prototype property */
    if (JS_DefinePropertyValueC(ctx, ctor, JS_ATOM_prototype,
                                proto, JS_PROP_THROW) < 0)
        goto fail;
    set_cycle_flag(ctx, ctor);
    set_cycle_flag(ctx, proto);
`,
		},
		// Defines a constructor's prototype and the prototype's constructor with borrowed values
		{
			file: "quickjs.c",
			find: String.raw`                              JSValueConst proto,
                              int proto_flags, int ctor_flags)
{
    if (JS_DefinePropertyValue(ctx, func_obj, JS_ATOM_prototype,
                               JS_DupValue(ctx, proto), proto_flags) < 0)
        return -1;
    if (JS_DefinePropertyValue(ctx, proto, JS_ATOM_constructor,
                               JS_DupValue(ctx, func_obj),
                               ctor_flags) < 0)
        return -1;
    set_cycle_flag(ctx, func_obj);
    set_cycle_flag(ctx, proto);
`,
			replace: String.raw`                              JSValueConst proto,
                              int proto_flags, int ctor_flags)
{
    if (JS_DefinePropertyValueC(ctx, func_obj, JS_ATOM_prototype,
                                proto, proto_flags) < 0)
        return -1;
    if (JS_DefinePropertyValueC(ctx, proto, JS_ATOM_constructor,
                                func_obj,
                                ctor_flags) < 0)
        return -1;
    set_cycle_flag(ctx, func_obj);
    set_cycle_flag(ctx, proto);
`,
		},
		// Builds an own property descriptor's fields with borrowed values
		{
			file: "quickjs.c",
			find: String.raw`                goto exception1;
            flags = JS_PROP_C_W_E | JS_PROP_THROW;
            if (desc.flags & JS_PROP_GETSET) {
                if (JS_DefinePropertyValue(ctx, ret, JS_ATOM_get, JS_DupValue(ctx, desc.getter), flags) < 0
                ||  JS_DefinePropertyValue(ctx, ret, JS_ATOM_set, JS_DupValue(ctx, desc.setter), flags) < 0)
                    goto exception1;
            } else {
                if (JS_DefinePropertyValue(ctx, ret, JS_ATOM_value, JS_DupValue(ctx, desc.value), flags) < 0
                ||  JS_DefinePropertyValue(ctx, ret, JS_ATOM_writable,
                                           JS_NewBool(ctx, desc.flags & JS_PROP_WRITABLE), flags) < 0)
                    goto exception1;
`,
			replace: String.raw`                goto exception1;
            flags = JS_PROP_C_W_E | JS_PROP_THROW;
            if (desc.flags & JS_PROP_GETSET) {
                if (JS_DefinePropertyValueC(ctx, ret, JS_ATOM_get, desc.getter, flags) < 0
                ||  JS_DefinePropertyValueC(ctx, ret, JS_ATOM_set, desc.setter, flags) < 0)
                    goto exception1;
            } else {
                if (JS_DefinePropertyValueC(ctx, ret, JS_ATOM_value, desc.value, flags) < 0
                ||  JS_DefinePropertyValue(ctx, ret, JS_ATOM_writable,
                                           JS_NewBool(ctx, desc.flags & JS_PROP_WRITABLE), flags) < 0)
                    goto exception1;
`,
		},
		// Checks the define of a bound function's length
		{
			file: "quickjs.c",
			find: String.raw`            len_val = JS_NewInt32(ctx, 0);
        }
    }
    JS_DefinePropertyValue(ctx, func_obj, JS_ATOM_length,
                           len_val, JS_PROP_CONFIGURABLE);

    name1 = JS_GetProperty(ctx, this_val, JS_ATOM_name);
    if (JS_IsException(name1))
`,
			replace: String.raw`            len_val = JS_NewInt32(ctx, 0);
        }
    }
    if (JS_DefinePropertyValue(ctx, func_obj, JS_ATOM_length,
                               len_val, JS_PROP_CONFIGURABLE) < 0)
        goto exception;

    name1 = JS_GetProperty(ctx, this_val, JS_ATOM_name);
    if (JS_IsException(name1))
`,
		},
		// Checks the define of a bound function's name
		{
			file: "quickjs.c",
			find: String.raw`    name1 = JS_ConcatString3(ctx, "bound ", name1, "");
    if (JS_IsException(name1))
        goto exception;
    JS_DefinePropertyValue(ctx, func_obj, JS_ATOM_name, name1,
                           JS_PROP_CONFIGURABLE);
    return func_obj;
 exception:
    JS_FreeValue(ctx, func_obj);
`,
			replace: String.raw`    name1 = JS_ConcatString3(ctx, "bound ", name1, "");
    if (JS_IsException(name1))
        goto exception;
    if (JS_DefinePropertyValue(ctx, func_obj, JS_ATOM_name, name1,
                               JS_PROP_CONFIGURABLE) < 0)
        goto exception;
    return func_obj;
 exception:
    JS_FreeValue(ctx, func_obj);
`,
		},
		// Checks the define of an error's message
		{
			file: "quickjs.c",
			find: String.raw`        msg = JS_ToString(ctx, message);
        if (unlikely(JS_IsException(msg)))
            goto exception;
        JS_DefinePropertyValue(ctx, obj, JS_ATOM_message, msg,
                               JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    }

    if (arg_index < argc) {
`,
			replace: String.raw`        msg = JS_ToString(ctx, message);
        if (unlikely(JS_IsException(msg)))
            goto exception;
        if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_message, msg,
                                   JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0)
            goto exception;
    }

    if (arg_index < argc) {
`,
		},
		// Checks the define of an error's cause
		{
			file: "quickjs.c",
			find: String.raw`                JSValue cause = JS_GetProperty(ctx, options, JS_ATOM_cause);
                if (JS_IsException(cause))
                    goto exception;
                JS_DefinePropertyValue(ctx, obj, JS_ATOM_cause, cause,
                                       JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
            }
        }
    }
`,
			replace: String.raw`                JSValue cause = JS_GetProperty(ctx, options, JS_ATOM_cause);
                if (JS_IsException(cause))
                    goto exception;
                if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_cause, cause,
                                           JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0)
                    goto exception;
            }
        }
    }
`,
		},
		// Checks the define of an AggregateError's errors, and frees the error when it fails
		{
			file: "quickjs.c",
			find: String.raw`                                 JS_CLASS_ERROR);
    if (JS_IsException(obj))
        return obj;
    JS_DefinePropertyValue(ctx, obj, JS_ATOM_errors, JS_DupValue(ctx, errors),
                           JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    return obj;
}
`,
			replace: String.raw`                                 JS_CLASS_ERROR);
    if (JS_IsException(obj))
        return obj;
    if (JS_DefinePropertyValueC(ctx, obj, JS_ATOM_errors, errors,
                               JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE) < 0) {
        JS_FreeValue(ctx, obj);
        return JS_EXCEPTION;
    }
    return obj;
}
`,
		},
		// Sets an iterator's constructor with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`    if (argc > 0) { // if setter
        if (!JS_IsObject(argv[0]))
            return JS_ThrowTypeErrorNotAnObject(ctx);
        ret = JS_DefinePropertyValue(ctx, this_val, JS_ATOM_constructor,
                                     JS_DupValue(ctx, argv[0]),
                                     JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
        if (ret < 0)
            return JS_EXCEPTION;
        return JS_UNDEFINED;
`,
			replace: String.raw`    if (argc > 0) { // if setter
        if (!JS_IsObject(argv[0]))
            return JS_ThrowTypeErrorNotAnObject(ctx);
        ret = JS_DefinePropertyValueC(ctx, this_val, JS_ATOM_constructor,
                                      argv[0],
                                      JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
        if (ret < 0)
            return JS_EXCEPTION;
        return JS_UNDEFINED;
`,
		},
		// Sets an iterator's Symbol.toStringTag with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`        if (JS_SetProperty(ctx, this_val, JS_ATOM_Symbol_toStringTag, JS_DupValue(ctx, val)) < 0)
            return JS_EXCEPTION;
    } else {
        if (JS_DefinePropertyValue(ctx, this_val, JS_ATOM_Symbol_toStringTag, JS_DupValue(ctx, val), JS_PROP_C_W_E) < 0)
            return JS_EXCEPTION;
    }
    return JS_UNDEFINED;
`,
			replace: String.raw`        if (JS_SetProperty(ctx, this_val, JS_ATOM_Symbol_toStringTag, JS_DupValue(ctx, val)) < 0)
            return JS_EXCEPTION;
    } else {
        if (JS_DefinePropertyValueC(ctx, this_val, JS_ATOM_Symbol_toStringTag, val, JS_PROP_C_W_E) < 0)
            return JS_EXCEPTION;
    }
    return JS_UNDEFINED;
`,
		},
		// Checks the define of a String object's length, and frees the object when it fails
		{
			file: "quickjs.c",
			find: String.raw`            JS_FreeValue(ctx, val);
        } else {
            JS_SetObjectData(ctx, obj, val);
            JS_DefinePropertyValue(ctx, obj, JS_ATOM_length, JS_NewInt32(ctx, p1->len), 0);
        }
        return obj;
    } else {
`,
			replace: String.raw`            JS_FreeValue(ctx, val);
        } else {
            JS_SetObjectData(ctx, obj, val);
            if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_length, JS_NewInt32(ctx, p1->len), 0) < 0) {
                JS_FreeValue(ctx, obj);
                return JS_EXCEPTION;
            }
        }
        return obj;
    } else {
`,
		},
		// Defines a match's group indices with borrowed values
		{
			file: "quickjs.c",
			find: String.raw`                    /* JS_HasProperty() cannot fail here */
                    if (!JS_IsUndefined(val) ||
                        !JS_HasProperty(ctx, indices_groups, group_name)) {
                        if (JS_DefinePropertyValue(ctx, indices_groups,
                                                   group_name, JS_DupValue(ctx, val), prop_flags) < 0) {
                            JS_FreeValue(ctx, val);
                            goto fail;
                        }
`,
			replace: String.raw`                    /* JS_HasProperty() cannot fail here */
                    if (!JS_IsUndefined(val) ||
                        !JS_HasProperty(ctx, indices_groups, group_name)) {
                        if (JS_DefinePropertyValueC(ctx, indices_groups,
                                                    group_name, val, prop_flags) < 0) {
                            JS_FreeValue(ctx, val);
                            goto fail;
                        }
`,
		},
		// Defines a match's groups with borrowed values
		{
			file: "quickjs.c",
			find: String.raw`                /* JS_HasProperty() cannot fail here */
                if (!JS_IsUndefined(val) ||
                    !JS_HasProperty(ctx, groups, group_name)) {
                    if (JS_DefinePropertyValue(ctx, groups, group_name,
                                               JS_DupValue(ctx, val),
                                               prop_flags) < 0) {
                        JS_FreeValue(ctx, val);
                        goto fail;
                    }
`,
			replace: String.raw`                /* JS_HasProperty() cannot fail here */
                if (!JS_IsUndefined(val) ||
                    !JS_HasProperty(ctx, groups, group_name)) {
                    if (JS_DefinePropertyValueC(ctx, groups, group_name,
                                                val, prop_flags) < 0) {
                        JS_FreeValue(ctx, val);
                        goto fail;
                    }
`,
		},
		// Wraps the value JSON.stringify starts from with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`    wrapper = JS_NewObject(ctx);
    if (JS_IsException(wrapper))
        goto exception;
    if (JS_DefinePropertyValue(ctx, wrapper, JS_ATOM_empty_string,
                               JS_DupValue(ctx, obj), JS_PROP_C_W_E) < 0)
        goto exception;
    val = JS_DupValue(ctx, obj);
`,
			replace: String.raw`    wrapper = JS_NewObject(ctx);
    if (JS_IsException(wrapper))
        goto exception;
    if (JS_DefinePropertyValueC(ctx, wrapper, JS_ATOM_empty_string,
                                obj, JS_PROP_C_W_E) < 0)
        goto exception;
    val = JS_DupValue(ctx, obj);
`,
		},
		// Checks each field of a descriptor object, and frees the object when one fails
		{
			file: "quickjs.c",
			find: String.raw`    if (JS_IsException(ret))
        return ret;
    if (flags & JS_PROP_HAS_GET) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_get, JS_DupValue(ctx, getter),
                               JS_PROP_C_W_E);
    }
    if (flags & JS_PROP_HAS_SET) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_set, JS_DupValue(ctx, setter),
                               JS_PROP_C_W_E);
    }
    if (flags & JS_PROP_HAS_VALUE) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_value, JS_DupValue(ctx, val),
                               JS_PROP_C_W_E);
    }
    if (flags & JS_PROP_HAS_WRITABLE) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_writable,
                               JS_NewBool(ctx, flags & JS_PROP_WRITABLE),
                               JS_PROP_C_W_E);
    }
    if (flags & JS_PROP_HAS_ENUMERABLE) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_enumerable,
                               JS_NewBool(ctx, flags & JS_PROP_ENUMERABLE),
                               JS_PROP_C_W_E);
    }
    if (flags & JS_PROP_HAS_CONFIGURABLE) {
        JS_DefinePropertyValue(ctx, ret, JS_ATOM_configurable,
                               JS_NewBool(ctx, flags & JS_PROP_CONFIGURABLE),
                               JS_PROP_C_W_E);
    }
    return ret;
}
`,
			replace: String.raw`    if (JS_IsException(ret))
        return ret;
    if (flags & JS_PROP_HAS_GET) {
        if (JS_DefinePropertyValueC(ctx, ret, JS_ATOM_get, getter,
                                    JS_PROP_C_W_E) < 0)
            goto fail;
    }
    if (flags & JS_PROP_HAS_SET) {
        if (JS_DefinePropertyValueC(ctx, ret, JS_ATOM_set, setter,
                                    JS_PROP_C_W_E) < 0)
            goto fail;
    }
    if (flags & JS_PROP_HAS_VALUE) {
        if (JS_DefinePropertyValueC(ctx, ret, JS_ATOM_value, val,
                                    JS_PROP_C_W_E) < 0)
            goto fail;
    }
    if (flags & JS_PROP_HAS_WRITABLE) {
        if (JS_DefinePropertyValue(ctx, ret, JS_ATOM_writable,
                                   JS_NewBool(ctx, flags & JS_PROP_WRITABLE),
                                   JS_PROP_C_W_E) < 0)
            goto fail;
    }
    if (flags & JS_PROP_HAS_ENUMERABLE) {
        if (JS_DefinePropertyValue(ctx, ret, JS_ATOM_enumerable,
                                   JS_NewBool(ctx, flags & JS_PROP_ENUMERABLE),
                                   JS_PROP_C_W_E) < 0)
            goto fail;
    }
    if (flags & JS_PROP_HAS_CONFIGURABLE) {
        if (JS_DefinePropertyValue(ctx, ret, JS_ATOM_configurable,
                                   JS_NewBool(ctx, flags & JS_PROP_CONFIGURABLE),
                                   JS_PROP_C_W_E) < 0)
            goto fail;
    }
    return ret;
 fail:
    JS_FreeValue(ctx, ret);
    return JS_EXCEPTION;
}
`,
		},
		// Starts the revocable proxy's result as undefined, so the failure path can free it
		{
			file: "quickjs.c",
			find: String.raw`static JSValue js_proxy_revocable(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    JSValue proxy_obj, revoke_obj = JS_UNDEFINED, obj;

    proxy_obj = js_proxy_constructor(ctx, JS_UNDEFINED, argc, argv);
    if (JS_IsException(proxy_obj))
`,
			replace: String.raw`static JSValue js_proxy_revocable(JSContext *ctx, JSValueConst this_val,
                                 int argc, JSValueConst *argv)
{
    JSValue proxy_obj, revoke_obj = JS_UNDEFINED, obj = JS_UNDEFINED;

    proxy_obj = js_proxy_constructor(ctx, JS_UNDEFINED, argc, argv);
    if (JS_IsException(proxy_obj))
`,
		},
		// Checks both fields of the revocable proxy's result, and frees what each path holds
		{
			file: "quickjs.c",
			find: String.raw`    if (JS_IsException(obj))
        goto fail;
    // XXX: exceptions?
    JS_DefinePropertyValue(ctx, obj, JS_ATOM_proxy, proxy_obj, JS_PROP_C_W_E);
    JS_DefinePropertyValue(ctx, obj, JS_ATOM_revoke, revoke_obj, JS_PROP_C_W_E);
    return obj;
 fail:
    JS_FreeValue(ctx, proxy_obj);
    JS_FreeValue(ctx, revoke_obj);
    return JS_EXCEPTION;
}
`,
			replace: String.raw`    if (JS_IsException(obj))
        goto fail;
    // XXX: exceptions?
    if (JS_DefinePropertyValueC(ctx, obj, JS_ATOM_proxy, proxy_obj, JS_PROP_C_W_E) < 0 ||
        JS_DefinePropertyValueC(ctx, obj, JS_ATOM_revoke, revoke_obj, JS_PROP_C_W_E) < 0) {
        goto fail;
    }
    JS_FreeValue(ctx, proxy_obj);
    JS_FreeValue(ctx, revoke_obj);
    return obj;
 fail:
    JS_FreeValue(ctx, proxy_obj);
    JS_FreeValue(ctx, revoke_obj);
    JS_FreeValue(ctx, obj);
    return JS_EXCEPTION;
}
`,
		},
		// Defines an Object.groupBy group with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`                    goto exception;
                JS_FreeValue(ctx, res);
            } else {
                prop = JS_DupValue(ctx, prop);
                if (JS_DefinePropertyValue(ctx, groups, key_atom, prop,
                                           JS_PROP_C_W_E) < 0) {
                    goto exception;
                }
`,
			replace: String.raw`                    goto exception;
                JS_FreeValue(ctx, res);
            } else {
                if (JS_DefinePropertyValueC(ctx, groups, key_atom, prop,
                                           JS_PROP_C_W_E) < 0) {
                    goto exception;
                }
`,
		},
		// Defines the three fields of withResolvers' result with borrowed values, and frees the caller's references once on every path
		{
			file: "quickjs.c",
			find: String.raw`    obj = JS_NewObject(ctx);
    if (JS_IsException(obj))
        goto exception;
    if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_promise, result_promise,
                               JS_PROP_C_W_E) < 0) {
        goto exception;
    }
    result_promise = JS_UNDEFINED;
    if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_resolve, resolving_funcs[0],
                               JS_PROP_C_W_E) < 0) {
        goto exception;
    }
    resolving_funcs[0] = JS_UNDEFINED;
    if (JS_DefinePropertyValue(ctx, obj, JS_ATOM_reject, resolving_funcs[1],
                               JS_PROP_C_W_E) < 0) {
        goto exception;
    }
    return obj;
exception:
    JS_FreeValue(ctx, resolving_funcs[0]);
    JS_FreeValue(ctx, resolving_funcs[1]);
    JS_FreeValue(ctx, result_promise);
    JS_FreeValue(ctx, obj);
    return JS_EXCEPTION;
}

static JSValue js_promise_try(JSContext *ctx, JSValueConst this_val,
`,
			replace: String.raw`    obj = JS_NewObject(ctx);
    if (JS_IsException(obj))
        goto exception;
    if (JS_DefinePropertyValueC(ctx, obj, JS_ATOM_promise, result_promise,
                               JS_PROP_C_W_E) < 0 ||
        JS_DefinePropertyValueC(ctx, obj, JS_ATOM_resolve, resolving_funcs[0],
                               JS_PROP_C_W_E) < 0 ||
        JS_DefinePropertyValueC(ctx, obj, JS_ATOM_reject, resolving_funcs[1],
                               JS_PROP_C_W_E) < 0) {
    exception:
        JS_FreeValue(ctx, obj);
        obj = JS_EXCEPTION;
    }
    JS_FreeValue(ctx, resolving_funcs[0]);
    JS_FreeValue(ctx, resolving_funcs[1]);
    JS_FreeValue(ctx, result_promise);
    return obj;
}

static JSValue js_promise_try(JSContext *ctx, JSValueConst this_val,
`,
		},
		// Defines a Promise.allSettled entry's value with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`                                   str,
                                   JS_PROP_C_W_E) < 0)
            goto fail1;
        if (JS_DefinePropertyValue(ctx, obj,
                                   is_reject ? JS_ATOM_reason : JS_ATOM_value,
                                   JS_DupValue(ctx, argv[0]),
                                   JS_PROP_C_W_E) < 0) {
        fail1:
            JS_FreeValue(ctx, obj);
            return JS_EXCEPTION;
`,
			replace: String.raw`                                   str,
                                   JS_PROP_C_W_E) < 0)
            goto fail1;
        if (JS_DefinePropertyValueC(ctx, obj,
                                    is_reject ? JS_ATOM_reason : JS_ATOM_value,
                                    argv[0],
                                    JS_PROP_C_W_E) < 0) {
        fail1:
            JS_FreeValue(ctx, obj);
            return JS_EXCEPTION;
`,
		},
		// Defines globalThis with a borrowed value
		{
			file: "quickjs.c",
			find: String.raw`    if (JS_IsException(ctx->eval_obj))
        return -1;
    
    if (JS_DefinePropertyValue(ctx, ctx->global_obj, JS_ATOM_globalThis,
                               JS_DupValue(ctx, ctx->global_obj),
                               JS_PROP_CONFIGURABLE | JS_PROP_WRITABLE) < 0)
        return -1;

    /* BigInt */
`,
			replace: String.raw`    if (JS_IsException(ctx->eval_obj))
        return -1;
    
    if (JS_DefinePropertyValueC(ctx, ctx->global_obj, JS_ATOM_globalThis,
                                ctx->global_obj,
                                JS_PROP_CONFIGURABLE | JS_PROP_WRITABLE) < 0)
        return -1;

    /* BigInt */
`,
		},
		// Frees the toString function when the typed array prototype cannot be read
		{
			file: "quickjs.c",
			find: String.raw`        goto fail;
    /* XXX: should use alias method in JSCFunctionListEntry */ //@@@
    typed_array_base_proto = JS_GetProperty(ctx, typed_array_base_func, JS_ATOM_prototype);
    if (JS_IsException(typed_array_base_proto))
        goto fail;
    ret = JS_DefinePropertyValue(ctx, typed_array_base_proto, JS_ATOM_toString, obj,
                                 JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    JS_FreeValue(ctx, typed_array_base_proto);
`,
			replace: String.raw`        goto fail;
    /* XXX: should use alias method in JSCFunctionListEntry */ //@@@
    typed_array_base_proto = JS_GetProperty(ctx, typed_array_base_func, JS_ATOM_prototype);
    if (JS_IsException(typed_array_base_proto)) {
        JS_FreeValue(ctx, obj);
        goto fail;
    }
    ret = JS_DefinePropertyValue(ctx, typed_array_base_proto, JS_ATOM_toString, obj,
                                 JS_PROP_WRITABLE | JS_PROP_CONFIGURABLE);
    JS_FreeValue(ctx, typed_array_base_proto);
`,
		},
	],
};

export default patch;
