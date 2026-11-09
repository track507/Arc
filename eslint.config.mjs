import js from "@eslint/js";
import sonarjs from "eslint-plugin-sonarjs";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const CLOCK_MESSAGE = "The core reads time only through the Clock port in packages/core/src/clock/clock.ts";

// ! An error passes a cause, so a caller or a test reads what went wrong without parsing the message
const CAUSE_RULE = {
	selector: ":matches(NewExpression, CallExpression)[callee.name=/^[A-Z][A-Za-z]*Error$/]:not(:has(Property[key.name='cause']))",
	message: "Pass { cause } in the error's options: the caught error when rethrowing, or the rejected values as an object",
};

export default defineConfig(
	{ ignores: ["**/node_modules/**", "docs/**"] },

	{ ...js.configs.recommended },

	// * The configuration files at the root
	{
		files: ["**/*.mjs"],
		languageOptions: { globals: { ...globals.node } },
	},

	// * Every TypeScript file
	{
		files: ["**/*.ts"],
		extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			// * Naming conventions
			"@typescript-eslint/naming-convention": [
				"error",
				{ selector: "interface", format: ["PascalCase"] },
				{ selector: "typeAlias", format: ["PascalCase"] },
				{ selector: "class", format: ["PascalCase"] },
				{ selector: "enum", format: ["PascalCase"] },
				{ selector: "enumMember", format: ["PascalCase", "UPPER_CASE"] },
				{ selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"], leadingUnderscore: "allow" },
				{ selector: "function", format: ["camelCase", "PascalCase"] },
				{ selector: "parameter", format: ["camelCase"], leadingUnderscore: "allow" },
				{ selector: "method", format: ["camelCase"] },
				{ selector: "property", format: ["camelCase", "PascalCase", "UPPER_CASE"], leadingUnderscore: "allow" },
				{ selector: "property", modifiers: ["requiresQuotes"], format: null },
			],

			// * Explicit return types on exported functions
			"@typescript-eslint/explicit-function-return-type": ["error", { allowExpressions: true, allowTypedFunctionExpressions: true }],
			"@typescript-eslint/explicit-module-boundary-types": "error",

			// * Async safety
			"@typescript-eslint/no-floating-promises": "error",
			"@typescript-eslint/await-thenable": "error",
			"@typescript-eslint/no-misused-promises": "error",
			"@typescript-eslint/promise-function-async": "error",
			"@typescript-eslint/no-confusing-void-expression": "error",

			// * Type safety
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/strict-boolean-expressions": "error",
			"@typescript-eslint/prefer-nullish-coalescing": "error",
			"@typescript-eslint/prefer-optional-chain": "error",
			"@typescript-eslint/no-unnecessary-condition": "error",
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
			"@typescript-eslint/switch-exhaustiveness-check": "error",
			"@typescript-eslint/prefer-readonly": "error",

			// * Prevent unsafe operations
			"@typescript-eslint/no-unsafe-argument": "error",
			"@typescript-eslint/no-unsafe-assignment": "error",
			"@typescript-eslint/no-unsafe-call": "error",
			"@typescript-eslint/no-unsafe-member-access": "error",
			"@typescript-eslint/no-unsafe-return": "error",

			// * Import hygiene
			"@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "separate-type-imports" }],
			"@typescript-eslint/no-import-type-side-effects": "error",
			"@typescript-eslint/array-type": ["error", { default: "array-simple" }],

			// * Base rule overrides
			"no-unused-vars": "off",
			// ? An adapter that ignores a parameter its port declares names it with a leading underscore
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
			"no-undef": "off",
			"no-console": "error",
			eqeqeq: ["error", "always"],
			"no-var": "error",
			"prefer-const": "error",
			"no-param-reassign": "error",

			"no-eval": "error",
			"no-new-func": "error",
			"no-new-wrappers": "error",
			"no-script-url": "error",
			"no-self-compare": "error",
			"no-sequences": "error",
			"no-template-curly-in-string": "error",
			"no-unreachable-loop": "error",
			"array-callback-return": "error",
			"require-atomic-updates": "error",
			"no-lonely-if": "error",
			"object-shorthand": "error",
			"prefer-template": "error",
			"prefer-arrow-callback": "error",

			// * Errors
			"preserve-caught-error": ["error", { requireCatchParameter: true }],
			"no-restricted-syntax": ["error", CAUSE_RULE],
		},
	},

	// * Code quality
	{
		files: ["**/*.ts"],
		extends: [sonarjs.configs.recommended],
		rules: {
			// * TODO and FIXME are part of the house comment convention, not defects to be linted away
			"sonarjs/todo-tag": "off",
			"sonarjs/fixme-tag": "off",
		},
	},

	// ! A clock read inside the core makes a test or a replay depend on the real time
	// The core takes time from the Clock port, which the engine Worker's entry fills with the system clock or a manual one
	{
		files: ["packages/core/src/**/*.ts"],
		rules: {
			"no-restricted-properties": ["error", { object: "Date", property: "now", message: CLOCK_MESSAGE }],
			"no-restricted-syntax": [
				"error",
				CAUSE_RULE,
				{ selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: CLOCK_MESSAGE },
				{ selector: "CallExpression[callee.name='Date']", message: CLOCK_MESSAGE },
			],
		},
	}
);
