// * The boundaries
// A port is the file names after its folder in packages/core/src, such as clock/clock.ts
// An entry is src/entry.ts in a package, the one place that package chooses concrete adapters

/** @type {import("dependency-cruiser").IConfiguration} */
export default {
	forbidden: [
		{
			name: "no-circular",
			comment: "Modules in a cycle cannot be understood or tested apart",
			severity: "error",
			from: {},
			to: { circular: true },
		},
		{
			name: "core-imports-only-core",
			comment: "The core holds the policy and does no I/O, so it imports no adapter, no vendor package and no Node module",
			severity: "error",
			from: { path: "^packages/core/src/" },
			to: { pathNot: "^packages/core/src/" },
		},
		{
			name: "port-imports-only-model",
			comment: "A port is named in the core's own words, so it imports the model and nothing else",
			severity: "error",
			from: { path: "^packages/core/src/([^/]+)/\\1\\.ts$" },
			to: { pathNot: "^packages/core/src/model/" },
		},
		{
			name: "adapters-never-import-the-ui-or-an-entry",
			comment: "An entry chooses the adapters, so an adapter that reached the UI or an entry would be choosing for itself",
			severity: "error",
			from: { path: "^packages/(worker|document)/src/", pathNot: "/src/entry\\.ts$" },
			to: { path: ["^packages/(element|app)/", "/src/entry\\.ts$"] },
		},
		{
			name: "only-entries-import-another-package",
			comment: "An entry is the one place a concrete adapter is chosen, so no other file imports another package's source, except the core's",
			severity: "error",
			from: { path: "^packages/([^/]+)/src/", pathNot: "/src/entry\\.ts$" },
			to: { path: "^packages/(?!core/)[^/]+/src/", pathNot: "^packages/$1/src/" },
		},
		{
			name: "only-the-entry-and-the-runtime-adapter-load-the-engine",
			comment:
				"The rest of Arc runs scripts through the script runtime port, so only the entry that chooses the engine and the adapter that wraps it import @arc/engine",
			severity: "error",
			from: { path: "^packages/[^/]+/src/", pathNot: ["/src/entry\\.ts$", "^packages/worker/src/runtime/quickjs-runtime\\.ts$"] },
			to: { path: "^engine/" },
		},
		{
			name: "only-engine-tests-import-the-fault-build",
			comment: "The fault build carries a hook that fails allocations on demand and never ships, so nothing but the engine's tests imports it",
			severity: "error",
			from: { pathNot: "^engine/test/" },
			to: { path: "^engine/dist/fault/" },
		},
		{
			name: "patches-import-only-the-patch-type",
			comment: "A patch is data the chain applies, so it imports the Patch type and nothing else",
			severity: "error",
			from: { path: "^engine/patches/" },
			to: { pathNot: ["^engine/patches/", "^engine/scripts/patches\\.ts$"] },
		},
	],
	options: {
		doNotFollow: { path: ["node_modules", "^engine/dist/"] }, // ? engine/dist is the loader Emscripten generates, not part of arc's own code
		tsPreCompilationDeps: true,
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "default"],
		},
	},
};
