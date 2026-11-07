import { createApp } from './app.js';
import { readConfig } from './config.js';

async function bootstrap() {
  const config = readConfig();
  const app = await createApp();
  try {
    await app.listen(config.port, config.host);
    console.info('Commerce API listening on ' + config.host + ':' + config.port);
  } catch (error) {
    await app.close().catch(() => undefined);
    throw error;
  }
}

bootstrap().catch(() => {
  console.error('Startup failed. Check database configuration, service and port availability.');
  process.exitCode = 1;
});
