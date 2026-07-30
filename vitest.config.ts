/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		dir: 'test',
		environment: 'node',
		testTimeout: 90_000,
		server: {
			deps: {
				inline: ['stream-chain', 'stream-json'],
			},
		},
	},
});
