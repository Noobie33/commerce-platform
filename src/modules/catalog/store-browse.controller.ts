import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../authorization/route-policy.js';
import { StoreBrowseService } from './store-browse.service.js';
import { storeBrowseQuery } from './store-browse.validation.js';
@Controller('api/v1/store/products')
export class StoreBrowseController {
  constructor(private readonly service: StoreBrowseService) {}
  @Get() @Public() browse(@Query() query: unknown) {
    return this.service.browse(storeBrowseQuery(query));
  }
}
