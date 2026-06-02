# FHIR Controller Command Line Interface (CLI) Utilities

[![Build Status](https://ci.prestonlee.com/api/badges/preston/fhir-controller-cli/status.svg)](https://ci.prestonlee.com/preston/fhir-controller-cli)

The `fhir-controller` command line utility for interacting with remote FHIR servers from an on-premise or cloud host. This cross-platform executable provides:

- Command line interface for FHIR server operations
- Ability to upload a directory of Synthea FHIR output directly to a FHIR server in the correct dependency sequence
- Upload terminology systems (SNOMED CT, LOINC, RxNorm) to FHIR servers as CodeSystem resources
- Polling and auto-import capabilities for FHIR Controller deployments

# Installation

## NPM Package

```sh
# Install globally
npm install -g fhir-controller-cli

# Or use with npx (no installation required)
npx fhir-controller-cli help
```

## Docker Image

```sh
# Get high-level subcommand help
docker run --rm p3000/fhir-controller-cli:latest help

# Example of headless polling and auto-loading by reference to a FHIR Controller stack.json file (HTTP URL)
# Data loading will be triggered whenever the server confirms the absence of a special AuditEvent import record
docker run --rm --pull always p3000/fhir-controller-cli:latest poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json -i 5

# Local manifest on the host: bind-mount the directory that contains stack.json and referenced data files, then pass the in-container path
docker run --rm --pull always -v /path/to/stack-dir:/manifest p3000/fhir-controller-cli:latest poll-auditevent-and-trigger-import http://fhir.example.com/fhir /manifest/stack.json

# Example of uploading terminology systems
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm

# Advanced options examples
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc --batch-size 2000 --verbose
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed --keep-temporary --replace
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm --dry-run
```

## MCP Server

The package includes an MCP server with two transports:

- `stdio` for local MCP clients that launch the binary directly
- Streamable HTTP for container deployments at `/mcp`

### Build from clone

```sh
cd /path/to/fhir-controller-cli
npm install
npm run build
```

### Configure a Local Stdio MCP Client

For JSON-style MCP clients that launch a local process, use:

```json
{
  "mcpServers": {
    "fhir-controller": {
      "command": "node",
      "args": ["/path/to/fhir-controller-cli/build/bin/fhir-controller-mcp.js"]
    }
  }
}
```

### Run the HTTP MCP Server in Docker

The Docker image keeps `fhir-controller` as its entrypoint. Start the MCP server by passing the `mcp` subcommand and publishing port `8002`:

```sh
docker run --rm --pull always -p 8002:8002 p3000/fhir-controller-cli:latest mcp
```

The HTTP server uses Streamable HTTP, binds to `0.0.0.0` by default for container port publishing, and defaults to port `8002`. Override with `--host`, `--port`, `--path`, or the `FHIR_CONTROLLER_MCP_HOST`, `FHIR_CONTROLLER_MCP_PORT`, and `FHIR_CONTROLLER_MCP_PATH` environment variables. The MCP server does not add authentication, so publish it only on trusted local interfaces or behind your own access controls.

### Tools and Safety

The MCP server exposes:

- `fhir_controller_info`
- `fhir_server_reset`
- `fhir_cql_evaluate`
- `fhir_synthea_upload`
- `fhir_poll_auditevent_and_trigger_import`
- `fhir_terminology_import`

Mutating tools default to `dryRun: true`; pass `dryRun: false` only when you intend to write to the target FHIR server.

# Available Commands

## Server Reset

Permanently reset server data using the same driver-specific reset endpoints as the browser app.

```sh
# HAPI FHIR: POST /$expunge with expungeEverything=true
fhir-controller server reset http://localhost:8080/fhir --driver hapi-fhir

# WildFHIR: POST /$purge-all
fhir-controller server reset http://wildfhir.example.com/fhir --driver wild-fhir

# Preview the request without sending it
fhir-controller server reset http://localhost:8080/fhir --driver hapi-fhir --dry-run
```

Supported reset drivers are `hapi-fhir` and `wild-fhir` (`hapi` and `wildfhir` are accepted aliases). Generic and FHIR Candle do not currently support permanent reset behavior in FHIR Controller.

## Synthea Upload

Upload Synthea-generated FHIR resources to a FHIR server:

```sh
# Upload Synthea directory
fhir-controller synthea-upload /path/to/synthea/output/ http://localhost:8080/fhir

# With dry-run option
fhir-controller synthea-upload /path/to/synthea/output/ http://localhost:8080/fhir --dry-run
```

## Polling and Auto-Import

Monitor a FHIR server for AuditEvents and automatically trigger imports when the server has no matching import AuditEvent yet.

The second argument is the **stack manifest** (`stack.json`): an HTTP(S) URL, a `file://` URL, or a filesystem path. Relative paths are resolved from the current working directory; a leading `~/` expands to your home directory (same as other commands). Data files listed in the manifest are loaded from the same base as the manifest (URL resolution for remote manifests, directory-relative paths for local manifests).

The CLI logs browser-compatible manifest warnings for questionable configuration values, such as invalid URLs, unknown drivers or loaders, duplicate priorities, undefined scenarios, and missing CQL evaluation IDs. These warnings do not stop the import; they are informational so existing stacks keep running.

```sh
# Poll and import using a remote manifest URL
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json

# Local manifest (and local bundle paths next to it)
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir ./config/stack.json

# Only import rows tagged for a given scenario (manifest `scenarios[].id`; rows may list that id under `scenarios`)
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json --scenario partial

# Match the browser app's default scenario: untagged rows, plus rows explicitly tagged `default`
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json --scenario default

# Custom polling interval (seconds), verbose logging, dry run (no POST to FHIR)
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json --interval 300 --verbose --dry-run

# One shot: poll once, import if the server has no matching AuditEvent, then exit (no repeat interval)
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir ./config/stack.json --exit --dry-run
```

### Polling command options

- `--exit`: run a single poll cycle (and manifest import if triggered) then exit; `--interval` is ignored after that one cycle
- `--scenario <scenario_id>`: restrict imports to manifest `data` rows for that browser scenario. With `--scenario default`, rows with no `scenarios` array (or an empty one) are included along with rows tagged `default`. With any other scenario, only rows explicitly tagged for that scenario are included. Omitting `--scenario` preserves legacy CLI behavior and imports all `load=true` rows.
- `-i, --interval <seconds>`: minimum time between polls (default 3600)
- `-v, --verbose`: extra debug output
- `-d, --dry-run`: log actions without uploading to the FHIR server
- `--audit-event-system` / `--audit-event-code`: match and create the import AuditEvent type (defaults match the examples above)

### CQL Library imports

For manifest rows with `loader: "cql-as-fhir-library"`, the CLI now matches the browser app by reading the CQL `library <name> version '<version>'` declaration and uploading the primary FHIR `Library` resource to `Library/<name>` with that version. For backwards compatibility, when the legacy manifest-derived id differs from the CQL library name, the CLI also uploads a compatibility alias at the old `Library/<manifest-name>` id. If a CQL file has no parseable library declaration, the CLI keeps the previous behavior and uses the manifest-derived id and `item.version || "0.0.0"`.

## CQL Evaluation

Evaluate a CQL Library already loaded on a FHIR server:

```sh
fhir-controller cql evaluate http://localhost:8080/fhir HelloWorld Patient/cfsb1703736930464
fhir-controller cql evaluate http://localhost:8080/fhir Basic-Statin-Artifact cfsb1703736930464
```

The command POSTs the same FHIR `Parameters` shape as the browser app to `Library/<library_id>/$evaluate`, using a single `subject` parameter with `valueString` set to the subject argument.

## Terminology Imports

The CLI supports uploading major terminology systems to FHIR servers:

- **SNOMED CT US Edition**: Clinical terminology
- **LOINC**: Laboratory and clinical observations  
- **RxNorm**: Clinical drugs and medications

### CLI Options

The `terminology import` command supports the following options:

- `--system <system>`: Terminology system to import (snomed, loinc, rxnorm) - **Required**
- `--dry-run`: Perform a dry run without uploading any resources
- `--verbose`: Enable verbose debugging mode
- `--keep-temporary`: Keep temporary files after upload for debugging
- `--replace`: Delete existing CodeSystem and ValueSet before importing new ones
- `--batch-size <size>`: Number of concepts to process in each batch (default: 1000)
- `--skip-preprocess`: Skip preprocessing stage (use most recent files in temp directory)
- `--skip-split`: Skip splitting stage (use most recent files in temp directory)
- `--skip-upload`: Skip upload stage (only preprocess and split)

### Download Terminology Data

### SNOMED CT US Edition

- Download: https://www.nlm.nih.gov/healthit/snomedct/us_edition.html
- Format: .zip file (extract before use)

### LOINC

- Download from: https://loinc.org/downloads/
- Format: .zip file (extract before use)

### RxNorm

- Download from: https://www.nlm.nih.gov/research/umls/rxnorm/
- Format: .zip file (extract before use)

```sh
# Upload individual terminology systems

# SNOMED
fhir-controller terminology import ~/Developer/terminologies/SnomedCT_ManagedServiceUS_PRODUCTION_US1000124_20250901T120000Z http://localhost:8080/fhir tmp -v --keep-temporary --system snomed --replace

# LOINC
fhir-controller terminology import ~/Developer/terminologies/Loinc_2.81 http://localhost:8080/fhir tmp -v --keep-temporary --system loinc --replace

# RxNorm
fhir-controller terminology import ~/Developer/terminologies/RxNorm_full_09022025 http://localhost:8080/fhir tmp -v --keep-temporary --system rxnorm --replace

```

# Development & Testing Usage

```sh
# Run the CLI directly from source
tsx src/bin/fhir-controller.ts ...
```

This software is released under the Apache 2.0 license. Copyright © 2017+ Preston Lee.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/preston/marketplace. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [Contributor Covenant](http://contributor-covenant.org) code of conduct.
