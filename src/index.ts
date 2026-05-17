import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { startWebServer } from './web.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await startWebServer(config, logger);
}

main().catch((error) => {
  logger.error('fatal startup error', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
