import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Public } from '../authorization/route-policy.js';
import { StoreBrowseService } from './store-browse.service.js';
@Controller('api/v1/store/products')
export class StoreRelatedController {
  constructor(private readonly service: StoreBrowseService) {}
  @Get(':slug/related') @Public() read(
    @Param('slug') slug: string,
    @Query() query: Record<string, unknown>,
  ) {
    if (slug.length > 120 || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new NotFoundException();
    if (Object.keys(query).length) throw new BadRequestException({ code: 'INVALID_RELATED_QUERY' });
    return this.service.related(slug);
  }
}
