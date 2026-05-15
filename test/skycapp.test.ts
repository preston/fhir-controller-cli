// Author: Preston Lee

import path from 'path';
import { exec, ExecException } from 'child_process';
import { ImportUtilities } from '../src/import-utilities.js';

describe('`version` subcommand', () => {

    test('should report correct package version', async () => {
        let result = (await cli(['-V'], __dirname)).stdout.trim();
        // console.log("RESULTS: ", result);
        // let json = JSON.parse(result);
        expect(result).toBeTruthy();
    });

});

describe('`server` subcommand', () => {

    // test('should fail without argument', async () => {
    //     let out = (await cli(['server'], __dirname));
    //     expect(out.stdout.length).toBe(0);
    //     expect(out.stderr.length).toBeGreaterThanOrEqual(0);
    //     expect(out.code).toBe(1);
    // });
});

describe('scenario manifest row selection', () => {

    const stack = {
        scenarios: [
            { id: 'partial', name: 'Partial', description: 'Partial load' }
        ],
        data: [
            { name: 'untagged', load: true, priority: 30 },
            { name: 'default-tagged', load: true, priority: 20, scenarios: ['default'] },
            { name: 'partial-tagged', load: true, priority: 10, scenarios: ['partial'] },
            { name: 'partial-and-default', load: true, priority: 40, scenarios: ['partial', 'default'] },
            { name: 'disabled', load: false, priority: 5, scenarios: ['partial'] }
        ]
    };

    test('keeps legacy no-scenario behavior by importing every load=true row', () => {
        const rows = new ImportUtilities().selectDataFilesForImport(stack);
        expect(rows.map(row => row.name)).toEqual([
            'partial-tagged',
            'default-tagged',
            'untagged',
            'partial-and-default'
        ]);
    });

    test('matches browser default scenario behavior', () => {
        const rows = new ImportUtilities().selectDataFilesForImport(stack, 'default');
        expect(rows.map(row => row.name)).toEqual([
            'default-tagged',
            'untagged',
            'partial-and-default'
        ]);
    });

    test('requires explicit row tags for non-default scenarios', () => {
        const rows = new ImportUtilities().selectDataFilesForImport(stack, 'partial');
        expect(rows.map(row => row.name)).toEqual([
            'partial-tagged',
            'partial-and-default'
        ]);
    });

    test('allows the synthetic default scenario even when not declared', () => {
        expect(() => new ImportUtilities().ensureScenarioValid(stack, 'default')).not.toThrow();
    });

});

function cli(args: string[], cwd: string = __dirname) {
    return new Promise<{ code: number, error: ExecException | null, stdout: string, stderr: string }>(resolve => {
        exec(`node ${path.resolve('build/bin/fhir-controller.js')} ${args.join(' ')}`,
            { cwd },
            (error, stdout, stderr) => {
                resolve({
                    code: error && error.code ? error.code : 0,
                    error,
                    stdout,
                    stderr
                })
            })
    })
}
