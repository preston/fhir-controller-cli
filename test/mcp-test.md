# FHIR Controller MCP Smoke Tests

Copy one prompt at a time into an LLM client that has the `fhir-controller` MCP server configured. These prompts intentionally use `dryRun: false` where the tool supports it because the target is a disposable test FHIR server.

Test FHIR URL:

```text
http://127.0.0.1:8080/fhir/
```

Repository fixture paths:

```text
/path/to/fhir-controller-cli/test/data/example/fhir
/path/to/fhir-controller-cli/test/data/example/stack.json
```

## 1. MCP Info

```text
Use the fhir-controller MCP tool `fhir_controller_info`.

Return the tool result and confirm that the MCP server lists these tools:
`fhir_server_reset`, `fhir_cql_evaluate`, `fhir_synthea_upload`, `fhir_poll_auditevent_and_trigger_import`, and `fhir_terminology_import`.
```

## 2. Server Reset

```text
Use the fhir-controller MCP tool `fhir_server_reset` against:

http://127.0.0.1:8080/fhir/

Use driver `hapi-fhir` and `dryRun: false`.

Return the tool result and confirm whether the reset request completed successfully.
```

## 3. Synthea Upload

```text
Use the fhir-controller MCP tool `fhir_synthea_upload`.

Upload this Synthea/FHIR fixture directory to the test FHIR server:

directory:
/path/to/fhir-controller-cli/test/data/example/fhir

fhirUrl:
http://127.0.0.1:8080/fhir/

Set `dryRun: false`.

Return the tool result and confirm that the upload completed successfully.
```

## 4. Poll AuditEvent and Trigger Import

```text
Use the fhir-controller MCP tool `fhir_poll_auditevent_and_trigger_import`.

Run one poll/import cycle with:

manifestRef:
/path/to/fhir-controller-cli/test/data/example/stack.json

fhirUrl:
http://127.0.0.1:8080/fhir/

scenarioId:
default

auditEventSystem:
http://dicom.nema.org/resources/ontology/DCM

auditEventCode:
mcp-smoke-test-import

Set `dryRun: false` and `verbose: false`.

Return the tool result and confirm whether it imported data or skipped because a matching AuditEvent already existed.
```

## 5. CQL Evaluate

Run the Poll AuditEvent and Trigger Import prompt first so `Library/HelloWorld` and the test patient are available.

```text
Use the fhir-controller MCP tool `fhir_cql_evaluate`.

Evaluate:

fhirUrl:
http://127.0.0.1:8080/fhir/

libraryId:
HelloWorld

subject:
Patient/cfsb1703736930464

Return the tool result. If the server does not support CQL `$evaluate`, report the exact server error.
```

## 6. Terminology Import: LOINC

This requires a local LOINC source file or extracted LOINC directory. Replace `<LOINC_PATH>` with the real path before pasting.

```text
Use the fhir-controller MCP tool `fhir_terminology_import`.

Import LOINC to:

fhirUrl:
http://127.0.0.1:8080/fhir/

filePath:
<LOINC_PATH>

tempDir:
/tmp/fhir-controller-mcp-loinc

Use:
system: loinc
dryRun: false
verbose: true
keepTemporary: true
replace: true
batchSize: 1000
skipPreprocess: false
skipSplit: false
skipUpload: false

Return the tool result and summarize whether the import completed or failed.
```

## 7. Terminology Import: SNOMED CT

This requires a local SNOMED CT RF2 source ZIP or extracted directory. Replace `<SNOMED_PATH>` with the real path before pasting.

```text
Use the fhir-controller MCP tool `fhir_terminology_import`.

Import SNOMED CT to:

fhirUrl:
http://127.0.0.1:8080/fhir/

filePath:
<SNOMED_PATH>

tempDir:
/tmp/fhir-controller-mcp-snomed

Use:
system: snomed
dryRun: false
verbose: true
keepTemporary: true
replace: true
batchSize: 1000
skipPreprocess: false
skipSplit: false
skipUpload: false

Return the tool result and summarize whether the import completed or failed.
```

## 8. Terminology Import: RxNorm

This requires a local RxNorm source file or extracted RxNorm directory. Replace `<RXNORM_PATH>` with the real path before pasting.

```text
Use the fhir-controller MCP tool `fhir_terminology_import`.

Import RxNorm to:

fhirUrl:
http://127.0.0.1:8080/fhir/

filePath:
<RXNORM_PATH>

tempDir:
/tmp/fhir-controller-mcp-rxnorm

Use:
system: rxnorm
dryRun: false
verbose: true
keepTemporary: true
replace: true
batchSize: 1000
skipPreprocess: false
skipSplit: false
skipUpload: false

Return the tool result and summarize whether the import completed or failed.
```
