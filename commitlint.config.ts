import { RuleConfigSeverity, type UserConfig } from "@commitlint/types";

const config: UserConfig = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"type-enum": [RuleConfigSeverity.Error, "always", ["feat", "fix", "refactor", "perf", "test", "docs", "chore", "ci", "revert", "security"]],
		// Warn only, so an unlisted scope never blocks a commit
		"scope-enum": [
			RuleConfigSeverity.Warning,
			"always",
			["engine", "core", "worker", "document", "element", "app", "driver", "watcher", "test", "gate", "hooks", "tooling", "deps", "docs", "repo"],
		],
		"subject-case": [RuleConfigSeverity.Error, "always", "sentence-case"],
		"header-max-length": [RuleConfigSeverity.Error, "always", 100],
		"body-max-line-length": [RuleConfigSeverity.Error, "always", 120],
	},
};

export default config;
