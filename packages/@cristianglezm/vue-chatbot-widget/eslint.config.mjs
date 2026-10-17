import globals from 'globals';
import js from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import ts from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import vueParser from 'vue-eslint-parser';

export default [
    js.configs.recommended,
    ...pluginVue.configs['flat/recommended'],
    {
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parser: vueParser,
            parserOptions: {
                project: './tsconfig.app.json',
                ecmaVersion: 2022,
                sourceType: 'module',
                extraFileExtensions: ['.vue'],
                parser: {
                    ts: tsParser,
                },
            },
            globals: {
                ...globals.browser,
                ...globals.worker,
                ...globals.es2021
            }
        },
        plugins: {
            '@typescript-eslint': ts,
        },
        files: [
            'src/**/*.js',
            'src/**/*.vue',
            'src/**/*.ts',
            'src/**/*.tsx'
        ],
        ignores: [
            '*.config.*',
            'dist'
        ],
        rules: {
            'vue/singleline-html-element-content-newline': 'off',
            'vue/max-attributes-per-line': 'off',
            'vue/script-setup-uses-vars': 'error',
            'vue/multi-word-component-names': 'off',
            'vue/attribute-hyphenation': 'off',
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', {
                    "args": 'all',
                    "argsIgnorePattern": '^_',
                    "caughtErrors": 'all',
                    "caughtErrorsIgnorePattern": '^_',
                    "destructuredArrayIgnorePattern": '^_',
                    "varsIgnorePattern": '^_',
                    "ignoreRestSiblings": true
            }],
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
        }
    }
];
