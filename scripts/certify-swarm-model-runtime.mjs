#!/usr/bin/env bun

import { FetchTransport } from '../src/swarm/models/transport.ts';
import { configFromEnvironment, formatCertificationReport, runCertification } from './certify-swarm-model-runtime.ts';

const config = configFromEnvironment();
const result = await runCertification(config, new FetchTransport());

console.log(formatCertificationReport(result.report));
process.exitCode = result.report.CERTIFICATION_RESULT === 'PASS' ? 0 : 1;
