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

# Example of headless polling and auto-loading by reference to a FHIR Controller stack.json file
# Data loading will be triggered whenever the server confirms the absence of a special AuditEvent import record
docker run --rm --pull always p3000/fhir-controller-cli:latest poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json -i 5

# Example of uploading terminology systems
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm

# Advanced options examples
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc --batch-size 2000 --verbose
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed --keep-temporary --replace
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology import /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm --dry-run
```

# Available Commands

## Synthea Upload

Upload Synthea-generated FHIR resources to a FHIR server:

```sh
# Upload Synthea directory
fhir-controller synthea-upload /path/to/synthea/output/ http://localhost:8080/fhir

# With dry-run option
fhir-controller synthea-upload /path/to/synthea/output/ http://localhost:8080/fhir --dry-run
```

## Polling and Auto-Import

Monitor a FHIR server for AuditEvents and automatically trigger imports:

```sh
# Poll for AuditEvents and trigger imports
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json

# With custom polling interval (in seconds)
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json --interval 300

# With verbose logging
fhir-controller poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json --verbose
```

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
- `--replace`: Delete existing CodeSystem before importing new one
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
fhir-controller terminology import /path/to/extracted/snomed/ http://localhost:8080/fhir /tmp/staging --system snomed
fhir-controller terminology import /path/to/extracted/loinc/ http://localhost:8080/fhir /tmp/staging --system loinc
fhir-controller terminology import /path/to/extracted/rxnorm/ http://localhost:8080/fhir /tmp/staging --system rxnorm

# Advanced options
fhir-controller terminology import /path/to/loinc/ http://localhost:8080/fhir /tmp/staging --system loinc --batch-size 2000 --verbose
fhir-controller terminology import /path/to/snomed/ http://localhost:8080/fhir /tmp/staging --system snomed --keep-temporary --replace
fhir-controller terminology import /path/to/rxnorm/ http://localhost:8080/fhir /tmp/staging --system rxnorm --dry-run
```

# Development & Testing Usage

```sh
# Install TypeScript Node runner for convenience
npm i -g ts-node

# Run the CLI directly from source
ts-node src/bin/fhir-controller.ts help

# Test terminology import
ts-node src/bin/fhir-controller.ts terminology import /path/to/snomed/ http://localhost:8080/fhir /tmp/staging --system snomed

# Test Synthea upload
ts-node src/bin/fhir-controller.ts synthea-upload /path/to/synthea/output/ http://localhost:8080/fhir
```

This software is released under the Apache 2.0 license. Copyright © 2017+ Preston Lee.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/preston/marketplace. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [Contributor Covenant](http://contributor-covenant.org) code of conduct.
