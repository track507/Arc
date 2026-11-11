import type { Patch } from "../scripts/patches.ts";

/**
 * Bellard's 817509a: unicode_script returns its failure instead of looping
 *
 * The loop never reaches the interrupt, so a run's deadline cannot end it, and only ending the instance does
 * Arc's fault build reaches it on a regular expression with \p{Script=Greek} when one allocation in a known range fails
 * @see https://github.com/bellard/quickjs/commit/817509a87c3c0af362df576574784bae0dae8129
 */
const patch: Patch = {
	name: "02-unicode-script-fails-once",
	why: "unicode_script jumps back to its own cleanup after a failure, so an allocation that fails while a Unicode script property compiles loops forever, and with Script_Extensions frees the same blocks on each pass",
	source: { kind: "upstream", project: "bellard", commit: "817509a87c3c0af362df576574784bae0dae8129" },
	edits: [
		// Returns the failure, where the release jumped back to the cleanup above it, which had already run
		{
			file: "libunicode.c",
			find: String.raw`        cr_free(cr1);
        cr_free(cr2);
    }
    goto fail;
}

#define M(id) (1U << UNICODE_GC_ ## id)
`,
			replace: String.raw`        cr_free(cr1);
        cr_free(cr2);
    }
    return -1;
}

#define M(id) (1U << UNICODE_GC_ ## id)
`,
		},
	],
};

export default patch;
