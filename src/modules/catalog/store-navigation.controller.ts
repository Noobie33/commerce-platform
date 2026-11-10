import { Controller, Get } from '@nestjs/common';
import { Public } from '../authorization/route-policy.js';
import { StoreBrowseService } from './store-browse.service.js';
@Controller('api/v1/store/navigation')
export class StoreNavigationController {
  constructor(private readonly service: StoreBrowseService) {}
  @Get() @Public() read() {
    return this.service.navigation();
  }
}
