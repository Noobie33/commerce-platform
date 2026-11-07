import type { DatabaseDriver } from '../../src/infrastructure/database/database.service.js';

export class TestDatabaseDriver implements DatabaseDriver {
  isInitialized = false;
  available = true;
  startupFailure = false;
  closeCount = 0;

  async initialize() {
    if (this.startupFailure) throw new Error('private connection details');
    this.isInitialized = true;
    return this;
  }
  async destroy() {
    this.isInitialized = false;
    this.closeCount++;
  }
  async query(_sql: string) {
    if (!this.available) throw new Error('private connection details');
    return [{ version: 1 }];
  }
}
