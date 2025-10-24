# FHIR Controller Command Line Interface (CLI) Utilities

[![Build Status](https://ci.prestonlee.com/api/badges/preston/fhir-controller-cli/status.svg)](https://ci.prestonlee.com/preston/fhir-controller-cli)

The `fhir-controller` command line utility for interacting with a remote [FHIR Controller]() (or compatible) deployments from an on-premise or cloud host. This cross-platform executable provides:

- Command line interface supplement to a FHIR Controller deployment.
- Ability to upload a directory of Synthea FHIR output directly to a FHIR server in the correct dependency sequence.
- Upload terminology systems (SNOMED CT, LOINC, RxNorm) to FHIR servers as CodeSystem resources.
- "Agent" mode for real-time routing of remote commands to a local Docker engine, swarm, or other orchestration agent.

# Running via Docker Image

```sh
# Get high-level subcommand help.
docker run --rm p3000/fhir-controller-cli:latest help

# Example of headless polling and auto-loading by reference to a FHIR Controller stack.json file.
# Data loading will be triggered whenever the server affirmative confirms the _absense_ of a special AuditEvent import record.
docker run --rm --pull always p3000/fhir-controller-cli:latest poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json -i 5

# Example of uploading terminology systems
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm

# Advanced options examples
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/loinc.csv http://fhir.example.com/fhir /tmp/staging --system loinc --batch-size 2000 --verbose
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/snomed/ http://fhir.example.com/fhir /tmp/staging --system snomed --keep-temporary --replace
docker run --rm --pull always p3000/fhir-controller-cli:latest terminology-upload /data/rxnorm.csv http://fhir.example.com/fhir /tmp/staging --system rxnorm --dry-run
```

# Terminology Imports

The CLI supports uploading major terminology systems to FHIR servers:

- **SNOMED CT US Edition**: Clinical terminology
- **LOINC**: Laboratory and clinical observations  
- **RxNorm**: Clinical drugs and medications

## CLI Options

The `terminology-upload` command supports the following options:

- `--system <system>`: Terminology system to upload (snomed, loinc, rxnorm) - **Required**
- `--dry-run`: Perform a dry run without uploading any resources
- `--verbose`: Enable verbose debugging mode
- `--keep-temporary`: Keep temporary files after upload for debugging
- `--replace`: Delete existing CodeSystem before importing new one
- `--batch-size <size>`: Number of concepts to process in each batch (default: 1000)

Start by download the terminology

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
fhir-controller terminology-upload /path/to/extracted/snomed/ http://localhost:8080/fhir /tmp/staging --system snomed
fhir-controller terminology-upload /path/to/extracted/loinc/ http://localhost:8080/fhir /tmp/staging --system loinc
fhir-controller terminology-upload /path/to/extracted/rxnorm/ http://localhost:8080/fhir /tmp/staging --system rxnorm

# Advanced options
fhir-controller terminology-upload /path/to/loinc/ http://localhost:8080/fhir /tmp/staging --system loinc --batch-size 2000 --verbose
fhir-controller terminology-upload /path/to/snomed/ http://localhost:8080/fhir /tmp/staging --system snomed --keep-temporary --replace
fhir-controller terminology-upload /path/to/rxnorm/ http://localhost:8080/fhir /tmp/staging --system rxnorm --dry-run
```

# Development & Testing Usage

```sh
# Install TypeScript Node runner for convenience
npm i -g ts-node

# Run the CLI directly from source.
ts-node src/bin/fhir-controller.ts help
```

This software is released under the Apache 2.0 license. Copyright © 2017+ Preston Lee.

## Contributing

Bug reports and pull requests are welcome on GitHub at https://github.com/preston/marketplace. This project is intended to be a safe, welcoming space for collaboration, and contributors are expected to adhere to the [Contributor Covenant](http://contributor-covenant.org) code of conduct.
