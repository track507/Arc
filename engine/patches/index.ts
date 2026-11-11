import type { Patch } from "../scripts/patches.ts";

import backtraceHoldsItsError from "./01-backtrace-holds-its-error.ts";
import unicodeScriptFailsOnce from "./02-unicode-script-fails-once.ts";
import cStringFreesOnFailure from "./03-c-string-frees-on-failure.ts";
import lazyPropertySurvivesFailure from "./04-lazy-property-survives-failure.ts";
import closureVariableLimit from "./05-closure-variable-limit.ts";
import defineFailuresChecked from "./06-define-failures-checked.ts";
import sizesCannotWrap from "./07-sizes-cannot-wrap.ts";
import jsonIndentRope from "./08-json-indent-rope.ts";

/** The patches in the order the chain applies them to the release, each in its own numbered file beside this one */
export const PATCHES: readonly Patch[] = [
	backtraceHoldsItsError,
	unicodeScriptFailsOnce,
	cStringFreesOnFailure,
	lazyPropertySurvivesFailure,
	closureVariableLimit,
	defineFailuresChecked,
	sizesCannotWrap,
	jsonIndentRope,
];
