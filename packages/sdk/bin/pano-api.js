#!/usr/bin/env node
// pano-api: Pano API v1 tooling. Plain Node, no dependencies; the sources are in ./api/*.mjs.
import { main } from './api/cli.mjs';

process.exitCode = await main(process.argv.slice(2));
