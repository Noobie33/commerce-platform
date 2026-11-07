import { Public } from '../authorization/route-policy.js';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../../infrastructure/database/database.service.js';

@Public()
@Controller('api/v1/health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    if (!(await this.database.isReady())) {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
    return { status: 'ok' };
  }
}
