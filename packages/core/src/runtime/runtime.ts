/** A script to run, and the name its errors and stack traces give it */
export interface Script {
	readonly name: string;
	readonly source: string;
}

/**
 * How a run ended
 *
 * - value: the script finished, and text is its completion value as String() gives it
 * - error: the script threw, and the fields are the thrown value's own, empty where it has none
 * - dead: the runtime can run nothing more, and the caller creates a new one
 */
export type RunOutcome =
	| { readonly kind: "value"; readonly text: string }
	| { readonly kind: "error"; readonly name: string; readonly message: string; readonly stack: string }
	| { readonly kind: "dead" };

/**
 * Runs the sheet's scripts, one at a time, in one global scope that lasts as long as the runtime
 *
 * The engine Worker's entry chooses the engine, and tests choose a fake one
 */
export interface ScriptRuntime {
	/**
	 * Runs a script as a global script, so its declarations stay for the scripts after it
	 *
	 * ? The promise lets a later runtime pause a run while the host answers a blocking call
	 */
	run(script: Script): Promise<RunOutcome>;
}
