# FHIR Controller Command Line Interface (CLI) Utilities

[![Build Status](https://ci.prestonlee.com/api/badges/preston/fhir-controller-cli/status.svg)](https://ci.prestonlee.com/preston/fhir-controller-cli)

The `fhir-controller` command line utility for interacting with a remote [FHIR Controller]() (or compatible) deployments from an on-premise or cloud host. This cross-platform executable provides a:

- Command line interface supplement to a FHIR Controller deployment.
- Ability to upload a directory of Synthea FHIR output directly to a FHIR server in the correct dependency sequence.
- "Agent" mode for real-time routing of remote commands to a local Docker engine, swarm, or other orchestration agent.

# Running via Docker Image

```sh
# Get high-level subcommand help.
docker run --rm p3000/fhir-controller-cli:latest help

# Example of headless polling and auto-loading by reference to a FHIR Controller stack.json file.
# Data loading will be triggered whenever the server affirmative confirms the _absense_ of a special AuditEvent import record.
docker run --rm --pull always p3000/fhir-controller-cli:latest poll-auditevent-and-trigger-import http://fhir.example.com/fhir https://stack.foundry.hl7.org/stack.json -i 5
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
