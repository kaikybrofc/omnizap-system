#!/usr/bin/env node

import { formatCommandConfigValidationReport, validateAllCommandConfigs } from '../app/services/ai/commandConfigValidationService.js';

const report = validateAllCommandConfigs();
const printable = formatCommandConfigValidationReport(report, { maxErrors: 80 });

if (!report.ok) {
  console.error('[command-config-validation] falhou');
  console.error(printable);
  process.exit(1);
}

console.log('[command-config-validation] ok');
console.log(printable);
