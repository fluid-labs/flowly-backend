module.exports = {
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: "./tsconfig.json",
    },
    plugins: ["@typescript-eslint"],
    extends: [
        "eslint:recommended",
        "@typescript-eslint/recommended",
        "@typescript-eslint/recommended-requiring-type-checking",
    ],
    root: true,
    env: {
        node: true,
        jest: true,
    },
    ignorePatterns: [".eslintrc.js", "dist/", "node_modules/"],
    rules: {
        // TypeScript specific rules
        "@typescript-eslint/interface-name-prefix": "off",
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-explicit-any": "warn",
        "@typescript-eslint/no-unused-vars": [
            "error",
            { argsIgnorePattern: "^_" },
        ],
        "@typescript-eslint/prefer-const": "error",
        "@typescript-eslint/no-var-requires": "error",

        // General rules
        "no-console": "warn",
        "no-debugger": "error",
        "prefer-const": "error",
        "no-var": "error",
        "object-shorthand": "error",
        "prefer-template": "error",

        // Import rules
        "sort-imports": ["error", { ignoreDeclarationSort: true }],

        // Security rules
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",

        // Performance rules
        "no-loop-func": "error",

        // Style rules
        "comma-dangle": ["error", "always-multiline"],
        quotes: ["error", "single", { avoidEscape: true }],
        semi: ["error", "always"],
        indent: ["error", 2],
        "max-len": ["warn", { code: 120 }],

        // Async/await rules
        "require-await": "error",
        "no-return-await": "error",

        // Error handling
        "no-throw-literal": "error",
    },
    overrides: [
        {
            files: ["**/*.test.ts", "**/*.spec.ts"],
            rules: {
                "@typescript-eslint/no-explicit-any": "off",
                "no-console": "off",
            },
        },
    ],
};
