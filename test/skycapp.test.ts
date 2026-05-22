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

describe('stack configuration warnings', () => {

    test('returns browser-compatible warnings without throwing', () => {
        const warnings = new ImportUtilities().getStackConfigurationWarnings({
            fhir_base_url: 'localhost:8080/fhir',
            driver: 'unknown',
            links: [
                { name: 'Bad Link', url: '/relative' }
            ],
            scenarios: [
                { id: 'partial' }
            ],
            data: [
                {
                    file: '',
                    name: '',
                    loader: 'not-a-loader',
                    priority: -1,
                    scenarios: ['missing']
                },
                {
                    file: 'logic.cql',
                    name: 'Logic',
                    loader: 'cql-as-fhir-library',
                    priority: -1
                }
            ]
        });

        expect(warnings).toEqual([
            'FHIR Base URL may be invalid; expected HTTP or HTTPS URL.',
            'Driver "unknown" is not recognized; falling back to generic.',
            'Data file 1: File path is empty.',
            'Data file 1: Name is empty.',
            'Data file 1: Loader "not-a-loader" is not recognized.',
            'Data file 1: Priority is negative (-1).',
            'Data file 1: Scenario "missing" is not defined in scenarios.',
            'Data file 2 (Logic) of type cql-as-fhir-library has no evaluation ID; CQL $evaluate will not be available.',
            'Data file 2: Priority is negative (-1).',
            'Multiple data files share priority -1 (files 1, 2); load order may be ambiguous.',
            'Link 1 "Bad Link": URL is missing or invalid.'
        ]);
    });

    test('returns no warnings for a valid minimal stack configuration', () => {
        expect(new ImportUtilities().getStackConfigurationWarnings({
            fhir_base_url: 'https://example.org/fhir',
            driver: 'hapi',
            links: [
                { name: 'FHIR Server', url: 'https://example.org' }
            ],
            scenarios: [
                { id: 'partial' }
            ],
            data: [
                {
                    file: 'bundle.json',
                    name: 'Bundle',
                    loader: 'fhir-bundle',
                    priority: 1,
                    scenarios: ['default', 'partial']
                },
                {
                    file: 'logic.cql',
                    name: 'Logic',
                    loader: 'cql-as-fhir-library',
                    priority: 2,
                    evaluate: { id: 'Logic' }
                }
            ]
        })).toEqual([]);
    });

});

describe('CQL Library import helpers', () => {

    test('extracts browser-compatible CQL library name and version', () => {
        const cql = `library "BrowserAlignedLibrary" version '1.2.3'\nusing FHIR version '4.0.1'`;
        expect(new ImportUtilities().extractCqlLibraryNameAndVersion(cql)).toEqual({
            libraryName: 'BrowserAlignedLibrary',
            version: '1.2.3'
        });
    });

    test('returns null for CQL without a browser-parseable library declaration', () => {
        const cql = `library LegacyOnlyLibrary\nusing FHIR version '4.0.1'`;
        expect(new ImportUtilities().extractCqlLibraryNameAndVersion(cql)).toBeNull();
    });

    test('builds a browser-style FHIR Library resource from CQL metadata', () => {
        const cql = `library BrowserAlignedLibrary version '1.2.3'`;
        const resource = new ImportUtilities().buildCqlLibraryResource(
            'BrowserAlignedLibrary',
            '1.2.3',
            'Test description',
            cql,
            'https://example.org/fhir'
        );

        expect(resource).toMatchObject({
            resourceType: 'Library',
            id: 'BrowserAlignedLibrary',
            version: '1.2.3',
            name: 'BrowserAlignedLibrary',
            title: 'BrowserAlignedLibrary',
            status: 'active',
            description: 'Test description',
            url: 'https://example.org/fhir/Library/BrowserAlignedLibrary'
        });
        expect(Buffer.from(resource.content[0].data, 'base64').toString('utf8')).toEqual(cql);
    });

    test('preserves the legacy manifest-derived Library id helper', () => {
        expect(new ImportUtilities().legacyCqlLibraryIdFor({ name: 'Legacy Library Name!' }, 'logic.cql')).toEqual('LegacyLibraryName');
    });

});

describe('CQL evaluation helpers', () => {

    test('builds the browser-compatible CQL evaluate Parameters resource', () => {
        expect(new ImportUtilities().buildEvaluateParameters('Patient/example')).toEqual({
            resourceType: 'Parameters',
            parameter: [
                {
                    name: 'subject',
                    valueString: 'Patient/example'
                }
            ]
        });
    });

    test('builds a normalized CQL evaluate URL', () => {
        expect(new ImportUtilities().cqlEvaluateUrlFor('https://example.org/fhir/', 'Basic-Statin-Artifact')).toEqual(
            'https://example.org/fhir/Library/Basic-Statin-Artifact/$evaluate'
        );
    });

});

describe('server reset helpers', () => {

    test('normalizes supported reset driver aliases', () => {
        const utils = new ImportUtilities();
        expect(utils.normalizeResetDriver('hapi')).toEqual('hapi');
        expect(utils.normalizeResetDriver('hapi-fhir')).toEqual('hapi');
        expect(utils.normalizeResetDriver('wildfhir')).toEqual('wildfhir');
        expect(utils.normalizeResetDriver('wild-fhir')).toEqual('wildfhir');
    });

    test('rejects unsupported reset drivers', () => {
        expect(() => new ImportUtilities().normalizeResetDriver('fhircandle')).toThrow(/Unsupported reset driver/);
    });

    test('builds browser-compatible HAPI reset request details', () => {
        const utils = new ImportUtilities();
        expect(utils.resetServerUrlFor('https://example.org/fhir/', 'hapi-fhir')).toEqual('https://example.org/fhir/$expunge');
        expect(utils.resetServerPayloadFor('hapi-fhir')).toEqual({
            resourceType: 'Parameters',
            parameter: [
                {
                    name: 'expungeEverything',
                    valueBoolean: true
                }
            ]
        });
    });

    test('builds browser-compatible WildFHIR reset request details', () => {
        const utils = new ImportUtilities();
        expect(utils.resetServerUrlFor('https://example.org/fhir/', 'wild-fhir')).toEqual('https://example.org/fhir/$purge-all');
        expect(utils.resetServerPayloadFor('wild-fhir')).toEqual({});
    });

    test('returns reset request details in dry-run mode without a server call', async () => {
        await expect(new ImportUtilities(true).resetServerData('https://example.org/fhir/', 'hapi-fhir')).resolves.toEqual({
            dryRun: true,
            method: 'POST',
            url: 'https://example.org/fhir/$expunge',
            payload: {
                resourceType: 'Parameters',
                parameter: [
                    {
                        name: 'expungeEverything',
                        valueBoolean: true
                    }
                ]
            }
        });
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
