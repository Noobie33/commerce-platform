import { HttpException } from '@nestjs/common';
import type { BeforeApplicationShutdown, OnApplicationBootstrap } from '@nestjs/common';
import type { Client } from 'pg';
import type { ServerResponse } from 'node:http';
import type { Principal } from '../identity/http.types.js';
import type { IdentityService } from '../identity/identity.service.js';
import { parseHint, permittedTopics } from './change-hint.js';
import type { ChangeHint } from './change-hint.js';
interface Connection {
  staffId: string;
  res: ServerResponse;
  pending: ChangeHint[];
  sync: boolean;
  checking: boolean;
  flush: () => Promise<void>;
  close: () => void;
}
export class LiveUpdatesService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private client: Client | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private stopped = false;
  private connected = false;
  private connections = new Set<Connection>();
  constructor(
    private readonly auth: Pick<IdentityService, 'authenticate'>,
    private readonly factory: (() => Client) | null,
  ) {}
  async onApplicationBootstrap() {
    if (this.factory) await this.connect();
  }
  private async connect() {
    if (this.stopped || !this.factory) return;
    const client = this.factory();
    this.client = client;
    const failed = () => {
      if (this.client !== client) return;
      this.client = null;
      this.connected = false;
      for (const c of this.connections) this.send(c, 'degraded', {});
      void client.end().catch(() => undefined);
      if (!this.stopped && !this.retry) {
        this.retry = setTimeout(() => {
          this.retry = null;
          void this.connect();
        }, this.reconnectDelay);
        this.retry.unref();
        this.reconnectDelay = Math.min(30000, this.reconnectDelay * 2);
      }
    };
    client.on('error', failed);
    client.on('end', failed);
    client.on('notification', (n) => {
      if (this.client !== client || !this.connected || n.channel !== 'commerce_staff_changes')
        return;
      const hint = parseHint(n.payload ?? '');
      if (!hint) return;
      for (const c of this.connections) {
        if (c.pending.length < 128) c.pending.push(hint);
        else c.sync = true;
        void c.flush();
      }
    });
    try {
      await client.connect();
      await client.query('LISTEN commerce_staff_changes');
      if (this.stopped || this.client !== client) {
        await client.end().catch(() => undefined);
        return;
      }
      this.connected = true;
      this.reconnectDelay = 1000;
      for (const c of this.connections) {
        c.sync = true;
        void c.flush();
      }
    } catch {
      failed();
    }
  }
  private send(c: Connection, event: string, data: unknown) {
    if (c.res.destroyed || c.res.writableEnded) {
      c.close();
      return;
    }
    // End slow streams rather than buffering an unbounded history of hints.
    if (!c.res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n')) c.close();
  }
  open(token: string, principal: Principal, res: ServerResponse) {
    if (this.stopped) throw new HttpException('Live updates temporarily unavailable', 503);
    if (
      this.connections.size >= 256 ||
      [...this.connections].filter((c) => c.staffId === principal.id).length >= 5
    )
      throw new HttpException('Live connection limit reached', 429);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    let heartbeat: ReturnType<typeof setInterval> | undefined,
      batch: ReturnType<typeof setTimeout> | undefined,
      closed = false;
    const connection: Connection = {
      staffId: principal.id,
      res,
      pending: [],
      sync: true,
      checking: false,
      flush: async () => {},
      close: () => {},
    };
    const close = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (batch) clearTimeout(batch);
      this.connections.delete(connection);
      res.off('close', close);
      res.end();
    };
    connection.close = close;
    const check = async () => {
      if (closed || connection.checking) return;
      connection.checking = true;
      const hints = connection.pending.splice(0),
        sync = connection.sync;
      connection.sync = false;
      try {
        const current = await this.auth.authenticate(token, false);
        if (closed) return;
        if (current.mustChangePassword) {
          this.send(connection, 'session-ended', {});
          close();
          return;
        }
        if (sync) this.send(connection, this.connected ? 'ready' : 'degraded', {});
        const topics = sync ? ['all'] : permittedTopics(hints, current.grants);
        if (topics.length) this.send(connection, 'invalidate', { topics });
        else this.send(connection, 'heartbeat', {});
      } catch (error) {
        const status =
          error &&
          typeof error === 'object' &&
          'getStatus' in error &&
          typeof error.getStatus === 'function'
            ? error.getStatus()
            : 0;
        this.send(connection, status === 401 || status === 403 ? 'session-ended' : 'degraded', {});
        close();
      } finally {
        connection.checking = false;
        if (!closed && (connection.pending.length || connection.sync)) void connection.flush();
      }
    };
    connection.flush = async () => {
      if (closed || batch || connection.checking) return;
      batch = setTimeout(() => {
        batch = undefined;
        void check();
      }, 100);
      batch.unref();
    };
    this.connections.add(connection);
    res.on('close', close);
    heartbeat = setInterval(() => void check(), 15000);
    heartbeat.unref();
    void check();
  }
  async beforeApplicationShutdown() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    for (const c of this.connections) c.close();
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (client) await client.end().catch(() => undefined);
  }
}
