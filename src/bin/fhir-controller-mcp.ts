#!/usr/bin/env node

import { startMcpServerFromCli } from '../mcp-server.js';

await startMcpServerFromCli(process.argv.slice(2));
