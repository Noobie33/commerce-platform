import { Injectable } from '@nestjs/common';
import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';

export interface DatabaseDriver {
  readonly isInitialized: boolean;
  initialize(): Promise<unknown>;
  destroy(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
}

@Injectable()
export class DatabaseService
  implements OnApplicationBootstrap, BeforeApplicationShutdown, OnApplicationShutdown
{
  private draining = false;

  constructor(private readonly driver: DatabaseDriver) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.driver.initialize();
      if (!(await this.isReady())) throw new Error('Schema not ready');
    } catch {
      if (this.driver.isInitialized) await this.driver.destroy().catch(() => undefined);
      throw new Error('Database initialization failed');
    }
  }

  beforeApplicationShutdown(): void {
    this.draining = true;
  }

  async isReady(): Promise<boolean> {
    if (this.draining || !this.driver.isInitialized) return false;
    try {
      const rows = await this.driver.query(
        'SELECT version FROM app_schema_version WHERE singleton',
      );
      return !this.draining && Array.isArray(rows) && rows.length === 1 && rows[0]?.version === 1;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.driver.isInitialized) await this.driver.destroy();
  }
}
