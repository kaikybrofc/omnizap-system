import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const PACKAGE_LOG_DIR = path.join(PROJECT_ROOT, 'node_modules', '@kaikybrofc', 'logger-module', 'logs');

function ensureLoggerLogsRedirect() {
  try {
    fs.mkdirSync(PROJECT_LOG_DIR, { recursive: true });

    if (fs.existsSync(PACKAGE_LOG_DIR)) {
      const stat = fs.lstatSync(PACKAGE_LOG_DIR);
      if (stat.isSymbolicLink()) {
        return;
      }

      fs.rmSync(PACKAGE_LOG_DIR, { recursive: true, force: true });
    }

    fs.symlinkSync(PROJECT_LOG_DIR, PACKAGE_LOG_DIR, 'dir');
  } catch (error) {
    console.warn('[LoggerSetup] Falha ao redirecionar logs da lib para ./logs:', error?.message || error);
  }
}

ensureLoggerLogsRedirect();

const { default: logger } = await import('@kaikybrofc/logger-module');

export default logger;
