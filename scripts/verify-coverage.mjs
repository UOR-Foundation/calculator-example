#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateCoverage } from './coverage-contract.mjs';

const path = process.argv[2];
if (!path) throw new Error('usage: verify-coverage.mjs COVERAGE.json');
const [document, standards] = await Promise.all([
  readFile(path, 'utf8').then(JSON.parse),
  readFile('standards.lock', 'utf8').then(JSON.parse),
]);
validateCoverage(document, standards);
