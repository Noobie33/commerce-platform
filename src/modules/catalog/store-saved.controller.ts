import { Controller, Post, Body, Query, HttpCode, BadRequestException } from '@nestjs/common';
import { Public, PublicBodyRead } from '../authorization/route-policy.js';
import { StoreBrowseService } from './store-browse.service.js';
@Controller('api/v1/store/saved-products')
export class StoreSavedController {
  constructor(private readonly service: StoreBrowseService) {}
  @Post('resolve') @HttpCode(200) @Public() @PublicBodyRead() resolve(
    @Body() body: unknown,
    @Query() q: Record<string, unknown>,
  ) {
    if (
      Object.keys(q).length ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((k) => k !== 'productIds')
    )
      throw new BadRequestException({ code: 'INVALID_SAVED_PRODUCTS' });
    const ids = (body as { productIds: unknown }).productIds;
    if (
      !Array.isArray(ids) ||
      ids.length > 50 ||
      ids.some(
        (v) => typeof v !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v),
      ) ||
      new Set(ids).size !== ids.length
    )
      throw new BadRequestException({ code: 'INVALID_SAVED_PRODUCTS' });
    return this.service.resolveSaved(ids as string[]);
  }
}
