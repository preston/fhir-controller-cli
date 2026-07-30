import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';

import { CodeSystemChunker } from '../src/utilities/codesystem-chunker.js';

const fixturePath = path.join(import.meta.dirname, 'data/codesystem-chunker-fixture.json');

describe('CodeSystemChunker', () => {
	let stagingDir: string;

	beforeEach(() => {
		stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codesystem-chunker-test-'));
	});

	afterEach(() => {
		fs.rmSync(stagingDir, { recursive: true, force: true });
	});

	test('splits concepts into base metadata and chunk files', async () => {
		const chunker = new CodeSystemChunker({ verbose: false, chunkSize: 2 });
		const result = await chunker.splitCodeSystemFile(fixturePath, stagingDir);

		expect(fs.existsSync(result.baseFile)).toBe(true);
		expect(result.chunkFiles).toHaveLength(3);

		const base = JSON.parse(fs.readFileSync(result.baseFile, 'utf8'));
		expect(base.resourceType).toBe('CodeSystem');
		expect(base.id).toBe('test-codesystem');
		expect(base.content).toBe('fragment');
		expect(base.concept).toEqual([]);

		const chunk0 = JSON.parse(fs.readFileSync(result.chunkFiles[0]!, 'utf8'));
		const chunk1 = JSON.parse(fs.readFileSync(result.chunkFiles[1]!, 'utf8'));
		const chunk2 = JSON.parse(fs.readFileSync(result.chunkFiles[2]!, 'utf8'));

		expect(chunk0).toHaveLength(2);
		expect(chunk1).toHaveLength(2);
		expect(chunk2).toHaveLength(1);
		expect(chunk0[0].code).toBe('A');
		expect(chunk2[0].code).toBe('E');
	});
});
