import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's e8b6919: a function captures at most 65,535 variables, and the compiler stops at a failure
 *
 * The commit also makes the compiler stop where the release ignored a failure that its helpers return
 * Bellard's issue #589 reports it, with a script that Arc's product build runs as the fail-first test
 * @see https://github.com/bellard/quickjs/commit/e8b69194b3b60686ce32b1df65ded68bfd519bd4
 * @see https://github.com/bellard/quickjs/issues/589
 */
const patch: Patch = {
	name: "05-closure-variable-limit",
	why: "A function that captures more than 65,535 variables wraps the 16-bit index its bytecode stores, and its closures then read and write outside their frame",
	source: { kind: "upstream", project: "bellard", commit: "e8b69194b3b60686ce32b1df65ded68bfd519bd4" },
	edits: [
		// Refuses a capture past the 16-bit index the bytecode stores, with an error the script sees
		{
			file: "quickjs.c",
			find: String.raw`    s->jump_size++;
}

static inline void capture_var(JSFunctionDef *s, JSVarDef *vd)
{
    if (!vd->is_captured) {
        vd->is_captured = 1;
        vd->var_ref_idx = s->var_ref_count++;
    }
}

/* return the position of the next opcode or -1 if error */
`,
			replace: String.raw`    s->jump_size++;
}

static inline __exception int capture_var(JSFunctionDef *s, JSVarDef *vd)
{
    if (!vd->is_captured) {
        /* the variable reference indexes are currently stored on 16 bits */
        if (unlikely(s->var_ref_count >= JS_MAX_LOCAL_VARS)) {
            JS_ThrowInternalError(s->ctx, "too variable references");
            return -1;
        }
        vd->is_captured = 1;
        vd->var_ref_idx = s->var_ref_count++;
    }
    return 0;
}

/* return the position of the next opcode or -1 if error */
`,
		},
		// Stops the compile when an argument or a local cannot be captured for a reference
		{
			file: "quickjs.c",
			find: String.raw`                /* Create a dummy object with a named slot that is
                   a reference to the local variable */
                if (var_idx & ARGUMENT_VAR_OFFSET) {
                    capture_var(s, &s->args[var_idx - ARGUMENT_VAR_OFFSET]);
                    dbuf_putc(bc, OP_make_arg_ref);
                    dbuf_put_u32(bc, JS_DupAtom(ctx, var_name));
                    dbuf_put_u16(bc, var_idx - ARGUMENT_VAR_OFFSET);
                } else {
                    capture_var(s, &s->vars[var_idx]);
                    dbuf_putc(bc, OP_make_loc_ref);
                    dbuf_put_u32(bc, JS_DupAtom(ctx, var_name));
                    dbuf_put_u16(bc, var_idx);
`,
			replace: String.raw`                /* Create a dummy object with a named slot that is
                   a reference to the local variable */
                if (var_idx & ARGUMENT_VAR_OFFSET) {
                    if (capture_var(s, &s->args[var_idx - ARGUMENT_VAR_OFFSET]))
                        return -1;
                    dbuf_putc(bc, OP_make_arg_ref);
                    dbuf_put_u32(bc, JS_DupAtom(ctx, var_name));
                    dbuf_put_u16(bc, var_idx - ARGUMENT_VAR_OFFSET);
                } else {
                    if (capture_var(s, &s->vars[var_idx]))
                        return -1;
                    dbuf_putc(bc, OP_make_loc_ref);
                    dbuf_put_u32(bc, JS_DupAtom(ctx, var_name));
                    dbuf_put_u16(bc, var_idx);
`,
		},
		// Stops the compile when a with object cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`                var_idx = idx;
                break;
            } else if (vd->var_name == JS_ATOM__with_ && !is_pseudo_var) {
                capture_var(fd, vd);
                idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, idx, vd->var_name, FALSE, FALSE, JS_VAR_NORMAL);
                if (idx >= 0) {
                    dbuf_putc(bc, OP_get_var_ref);
`,
			replace: String.raw`                var_idx = idx;
                break;
            } else if (vd->var_name == JS_ATOM__with_ && !is_pseudo_var) {
                if (capture_var(fd, vd))
                    return -1;
                idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, idx, vd->var_name, FALSE, FALSE, JS_VAR_NORMAL);
                if (idx >= 0) {
                    dbuf_putc(bc, OP_get_var_ref);
`,
		},
		// Stops the compile when the eval object cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`        /* check eval object */
        if (!is_arg_scope && fd->var_object_idx >= 0 && !is_pseudo_var) {
            vd = &fd->vars[fd->var_object_idx];
            capture_var(fd, vd);
            idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL,
                                  fd->var_object_idx, vd->var_name,
                                  FALSE, FALSE, JS_VAR_NORMAL);
`,
			replace: String.raw`        /* check eval object */
        if (!is_arg_scope && fd->var_object_idx >= 0 && !is_pseudo_var) {
            vd = &fd->vars[fd->var_object_idx];
            if (capture_var(fd, vd))
                return -1;
            idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL,
                                  fd->var_object_idx, vd->var_name,
                                  FALSE, FALSE, JS_VAR_NORMAL);
`,
		},
		// Stops the compile when the argument scope's eval object cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`        /* check eval object in argument scope */
        if (fd->arg_var_object_idx >= 0 && !is_pseudo_var) {
            vd = &fd->vars[fd->arg_var_object_idx];
            capture_var(fd, vd);
            idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL,
                                  fd->arg_var_object_idx, vd->var_name,
                                  FALSE, FALSE, JS_VAR_NORMAL);
`,
			replace: String.raw`        /* check eval object in argument scope */
        if (fd->arg_var_object_idx >= 0 && !is_pseudo_var) {
            vd = &fd->vars[fd->arg_var_object_idx];
            if (capture_var(fd, vd))
                return -1;
            idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL,
                                  fd->arg_var_object_idx, vd->var_name,
                                  FALSE, FALSE, JS_VAR_NORMAL);
`,
		},
		// Stops the compile when an outer argument or local cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`    } else {
        /* find the corresponding closure variable */
        if (var_idx & ARGUMENT_VAR_OFFSET) {
            capture_var(fd, &fd->args[var_idx - ARGUMENT_VAR_OFFSET]);
            idx = get_closure_var(ctx, s, fd,
                                  JS_CLOSURE_ARG, var_idx - ARGUMENT_VAR_OFFSET,
                                  var_name, FALSE, FALSE, JS_VAR_NORMAL);
        } else {
            capture_var(fd, &fd->vars[var_idx]);
            idx = get_closure_var(ctx, s, fd,
                                  JS_CLOSURE_LOCAL, var_idx,
                                  var_name,
`,
			replace: String.raw`    } else {
        /* find the corresponding closure variable */
        if (var_idx & ARGUMENT_VAR_OFFSET) {
            if (capture_var(fd, &fd->args[var_idx - ARGUMENT_VAR_OFFSET]))
                return -1;
            idx = get_closure_var(ctx, s, fd,
                                  JS_CLOSURE_ARG, var_idx - ARGUMENT_VAR_OFFSET,
                                  var_name, FALSE, FALSE, JS_VAR_NORMAL);
        } else {
            if (capture_var(fd, &fd->vars[var_idx]))
                return -1;
            idx = get_closure_var(ctx, s, fd,
                                  JS_CLOSURE_LOCAL, var_idx,
                                  var_name,
`,
		},
		// Stops the compile when a private brand cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`        if (idx >= 0) {
            var_kind = fd->vars[idx].var_kind;
            if (is_ref) {
                capture_var(fd, &fd->vars[idx]);
                idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, idx, var_name,
                                      TRUE, TRUE, JS_VAR_NORMAL);
                if (idx < 0)
`,
			replace: String.raw`        if (idx >= 0) {
            var_kind = fd->vars[idx].var_kind;
            if (is_ref) {
                if (capture_var(fd, &fd->vars[idx]))
                    return -1;
                idx = get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, idx, var_name,
                                      TRUE, TRUE, JS_VAR_NORMAL);
                if (idx < 0)
`,
		},
		// Returns a failure from marking the variables an eval sees
		{
			file: "quickjs.c",
			find: String.raw`    return 0;
}

static void mark_eval_captured_variables(JSContext *ctx, JSFunctionDef *s,
                                         int scope_level)
{
    int idx;
    JSVarDef *vd;

    for (idx = s->scopes[scope_level].first; idx >= 0;) {
        vd = &s->vars[idx];
        capture_var(s, vd);
        idx = vd->scope_next;
    }
}

/* XXX: should handle the argument scope generically */
`,
			replace: String.raw`    return 0;
}

static __exception int mark_eval_captured_variables(JSContext *ctx, JSFunctionDef *s,
                                                    int scope_level)
{
    int idx;
    JSVarDef *vd;

    for (idx = s->scopes[scope_level].first; idx >= 0;) {
        vd = &s->vars[idx];
        if (capture_var(s, vd))
            return -1;
        idx = vd->scope_next;
    }
    return 0;
}

/* XXX: should handle the argument scope generically */
`,
		},
		// Returns a failure from adding the variables an eval sees
		{
			file: "quickjs.c",
			find: String.raw`            var_kind == JS_VAR_FUNCTION_NAME);
}

static void add_eval_variables(JSContext *ctx, JSFunctionDef *s)
{
    JSFunctionDef *fd;
    JSVarDef *vd;
`,
			replace: String.raw`            var_kind == JS_VAR_FUNCTION_NAME);
}

static __exception int add_eval_variables(JSContext *ctx, JSFunctionDef *s)
{
    JSFunctionDef *fd;
    JSVarDef *vd;
`,
		},
		// Passes up a failed capture of an argument an eval sees
		{
			file: "quickjs.c",
			find: String.raw`    for(i = 0; i < s->arg_count; i++) {
        vd = &s->args[i];
        capture_var(s, vd);
    }
    for(i = 0; i < s->var_count; i++) {
        vd = &s->vars[i];
`,
			replace: String.raw`    for(i = 0; i < s->arg_count; i++) {
        vd = &s->args[i];
        if (capture_var(s, vd))
            return -1;
    }
    for(i = 0; i < s->var_count; i++) {
        vd = &s->vars[i];
`,
		},
		// Passes up a failed capture of a local an eval sees
		{
			file: "quickjs.c",
			find: String.raw`        if (vd->scope_level == 0 &&
            vd->var_name != JS_ATOM__ret_ &&
            vd->var_name != JS_ATOM_NULL) {
            capture_var(s, vd);
        }
    }
`,
			replace: String.raw`        if (vd->scope_level == 0 &&
            vd->var_name != JS_ATOM__ret_ &&
            vd->var_name != JS_ATOM_NULL) {
            if (capture_var(s, vd))
                return -1;
        }
    }
`,
		},
		// Passes up a failed capture or closure variable for an outer scope an eval sees
		{
			file: "quickjs.c",
			find: String.raw`        scope_idx = fd->scopes[scope_level].first;
        while (scope_idx >= 0) {
            vd = &fd->vars[scope_idx];
            capture_var(fd, vd);
            get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, scope_idx,
                            vd->var_name, vd->is_const, vd->is_lexical, vd->var_kind);
            scope_idx = vd->scope_next;
        }
        is_arg_scope = (scope_idx == ARG_SCOPE_END);
`,
			replace: String.raw`        scope_idx = fd->scopes[scope_level].first;
        while (scope_idx >= 0) {
            vd = &fd->vars[scope_idx];
            if (capture_var(fd, vd))
                return -1;
            if (get_closure_var(ctx, s, fd, JS_CLOSURE_LOCAL, scope_idx,
                                vd->var_name, vd->is_const, vd->is_lexical, vd->var_kind) < 0)
                return -1;
            scope_idx = vd->scope_next;
        }
        is_arg_scope = (scope_idx == ARG_SCOPE_END);
`,
		},
		// Passes up a failed capture or closure variable for an outer argument an eval sees
		{
			file: "quickjs.c",
			find: String.raw`            for(i = 0; i < fd->arg_count; i++) {
                vd = &fd->args[i];
                if (vd->var_name != JS_ATOM_NULL) {
                    capture_var(fd, vd);
                    get_closure_var(ctx, s, fd,
                                    JS_CLOSURE_ARG, i, vd->var_name, FALSE,
                                    vd->is_lexical, JS_VAR_NORMAL);
                }
            }
            for(i = 0; i < fd->var_count; i++) {
`,
			replace: String.raw`            for(i = 0; i < fd->arg_count; i++) {
                vd = &fd->args[i];
                if (vd->var_name != JS_ATOM_NULL) {
                    if (capture_var(fd, vd))
                        return -1;
                    if (get_closure_var(ctx, s, fd,
                                        JS_CLOSURE_ARG, i, vd->var_name, FALSE,
                                        vd->is_lexical, JS_VAR_NORMAL) < 0)
                        return -1;
                }
            }
            for(i = 0; i < fd->var_count; i++) {
`,
		},
		// Passes up a failed capture or closure variable for an outer local an eval sees
		{
			file: "quickjs.c",
			find: String.raw`                if (vd->scope_level == 0 &&
                    vd->var_name != JS_ATOM__ret_ &&
                    vd->var_name != JS_ATOM_NULL) {
                    capture_var(fd, vd);
                    get_closure_var(ctx, s, fd,
                                    JS_CLOSURE_LOCAL, i, vd->var_name, FALSE,
                                    vd->is_lexical, JS_VAR_NORMAL);
                }
            }
        } else {
`,
			replace: String.raw`                if (vd->scope_level == 0 &&
                    vd->var_name != JS_ATOM__ret_ &&
                    vd->var_name != JS_ATOM_NULL) {
                    if (capture_var(fd, vd))
                        return -1;
                    if (get_closure_var(ctx, s, fd,
                                        JS_CLOSURE_LOCAL, i, vd->var_name, FALSE,
                                        vd->is_lexical, JS_VAR_NORMAL) < 0)
                        return -1;
                }
            }
        } else {
`,
		},
		// Passes up a failed capture or closure variable for an outer variable in the argument scope
		{
			file: "quickjs.c",
			find: String.raw`                vd = &fd->vars[i];
                /* do not close top level last result */
                if (vd->scope_level == 0 && is_var_in_arg_scope(vd->var_name, vd->var_kind)) {
                    capture_var(fd, vd);
                    get_closure_var(ctx, s, fd,
                                    JS_CLOSURE_LOCAL, i, vd->var_name, FALSE,
                                    vd->is_lexical, JS_VAR_NORMAL);
                }
            }
        }
`,
			replace: String.raw`                vd = &fd->vars[i];
                /* do not close top level last result */
                if (vd->scope_level == 0 && is_var_in_arg_scope(vd->var_name, vd->var_kind)) {
                    if (capture_var(fd, vd))
                        return -1;
                    if (get_closure_var(ctx, s, fd,
                                        JS_CLOSURE_LOCAL, i, vd->var_name, FALSE,
                                        vd->is_lexical, JS_VAR_NORMAL) < 0)
                        return -1;
                }
            }
        }
`,
		},
		// Reports success at the end of add_eval_variables
		{
			file: "quickjs.c",
			find: String.raw`            }
        }
    }
}

static void set_closure_from_var(JSContext *ctx, JSClosureVar *cv,
`,
			replace: String.raw`            }
        }
    }
    return 0;
}

static void set_closure_from_var(JSContext *ctx, JSClosureVar *cv,
`,
		},
		// Stops when the variables a direct eval call sees cannot be marked
		{
			file: "quickjs.c",
			find: String.raw`            {
                int call_argc = get_u16(bc_buf + pos + 1);
                scope = get_u16(bc_buf + pos + 1 + 2);
                mark_eval_captured_variables(ctx, s, scope);
                dbuf_putc(&bc_out, op);
                dbuf_put_u16(&bc_out, call_argc);
                dbuf_put_u16(&bc_out, s->scopes[scope].first - ARG_SCOPE_END);
`,
			replace: String.raw`            {
                int call_argc = get_u16(bc_buf + pos + 1);
                scope = get_u16(bc_buf + pos + 1 + 2);
                if (mark_eval_captured_variables(ctx, s, scope))
                    goto fail;
                dbuf_putc(&bc_out, op);
                dbuf_put_u16(&bc_out, call_argc);
                dbuf_put_u16(&bc_out, s->scopes[scope].first - ARG_SCOPE_END);
`,
		},
		// Stops when the variables an apply eval sees cannot be marked
		{
			file: "quickjs.c",
			find: String.raw`            break;
        case OP_apply_eval: /* convert scope index to adjusted variable index */
            scope = get_u16(bc_buf + pos + 1);
            mark_eval_captured_variables(ctx, s, scope);
            dbuf_putc(&bc_out, op);
            dbuf_put_u16(&bc_out, s->scopes[scope].first - ARG_SCOPE_END);
            break;
`,
			replace: String.raw`            break;
        case OP_apply_eval: /* convert scope index to adjusted variable index */
            scope = get_u16(bc_buf + pos + 1);
            if (mark_eval_captured_variables(ctx, s, scope))
                goto fail;
            dbuf_putc(&bc_out, op);
            dbuf_put_u16(&bc_out, s->scopes[scope].first - ARG_SCOPE_END);
            break;
`,
		},
		// Stops when a scope variable cannot be resolved, where the release went on reading at position -1
		{
			file: "quickjs.c",
			find: String.raw`            scope = get_u16(bc_buf + pos + 5);
            pos_next = resolve_scope_var(ctx, s, var_name, scope, op, &bc_out,
                                         NULL, NULL, pos_next);
            JS_FreeAtom(ctx, var_name);
            break;
        case OP_scope_make_ref:
`,
			replace: String.raw`            scope = get_u16(bc_buf + pos + 5);
            pos_next = resolve_scope_var(ctx, s, var_name, scope, op, &bc_out,
                                         NULL, NULL, pos_next);
            if (pos_next < 0)
                goto fail;
            JS_FreeAtom(ctx, var_name);
            break;
        case OP_scope_make_ref:
`,
		},
		// Stops when a scope reference cannot be resolved, for the same reason
		{
			file: "quickjs.c",
			find: String.raw`                ls->ref_count--;  /* always remove label reference */
                pos_next = resolve_scope_var(ctx, s, var_name, scope, op, &bc_out,
                                             bc_buf, ls, pos_next);
                JS_FreeAtom(ctx, var_name);
            }
            break;
`,
			replace: String.raw`                ls->ref_count--;  /* always remove label reference */
                pos_next = resolve_scope_var(ctx, s, var_name, scope, op, &bc_out,
                                             bc_buf, ls, pos_next);
                if (pos_next < 0)
                    goto fail;
                JS_FreeAtom(ctx, var_name);
            }
            break;
`,
		},
		// Leaves through the shared failure path, which frees the output buffer, when a label table cannot be allocated
		{
			file: "quickjs.c",
			find: String.raw`    if (s->jump_size) {
        s->jump_slots = js_mallocz(s->ctx, sizeof(*s->jump_slots) * s->jump_size);
        if (s->jump_slots == NULL)
            return -1;
    }
#endif
    /* XXX: Should skip this phase if not generating SHORT_OPCODES */
    if (s->line_number_size && !s->strip_debug) {
        s->line_number_slots = js_mallocz(s->ctx, sizeof(*s->line_number_slots) * s->line_number_size);
        if (s->line_number_slots == NULL)
            return -1;
        s->line_number_last = s->source_pos;
        s->line_number_last_pc = 0;
    }
`,
			replace: String.raw`    if (s->jump_size) {
        s->jump_slots = js_mallocz(s->ctx, sizeof(*s->jump_slots) * s->jump_size);
        if (s->jump_slots == NULL)
            goto fail;
    }
#endif
    /* XXX: Should skip this phase if not generating SHORT_OPCODES */
    if (s->line_number_size && !s->strip_debug) {
        s->line_number_slots = js_mallocz(s->ctx, sizeof(*s->line_number_slots) * s->line_number_size);
        if (s->line_number_slots == NULL)
            goto fail;
        s->line_number_last = s->source_pos;
        s->line_number_last_pc = 0;
    }
`,
		},
		// Stops when an argument the arguments object captures cannot be captured
		{
			file: "quickjs.c",
			find: String.raw`            /* the arguments are implicitly captured because
               references to them are created with the 'argument'
               object */
            for(i = 0; i < s->arg_count; i++)
                capture_var(s, &s->args[i]);
        }
        if (s->arguments_arg_idx >= 0)
            put_short_code(&bc_out, OP_set_loc, s->arguments_arg_idx);
`,
			replace: String.raw`            /* the arguments are implicitly captured because
               references to them are created with the 'argument'
               object */
            for(i = 0; i < s->arg_count; i++) {
                if (capture_var(s, &s->args[i]))
                    goto fail;
            }
        }
        if (s->arguments_arg_idx >= 0)
            put_short_code(&bc_out, OP_set_loc, s->arguments_arg_idx);
`,
		},
		// Stops making the function when the variables an eval sees cannot be added
		{
			file: "quickjs.c",
			find: String.raw`       are used to compile the eval and they must be ordered by scope,
       so it is necessary to create the closure variables before any
       other variable lookup is done. */
    if (fd->has_eval_call)
        add_eval_variables(ctx, fd);

    /* add the module global variables in the closure */
    if (fd->is_eval) {
`,
			replace: String.raw`       are used to compile the eval and they must be ordered by scope,
       so it is necessary to create the closure variables before any
       other variable lookup is done. */
    if (fd->has_eval_call) {
        if (add_eval_variables(ctx, fd))
            goto fail;
    }

    /* add the module global variables in the closure */
    if (fd->is_eval) {
`,
		},
	],
};

export default patch;
