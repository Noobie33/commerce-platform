import {
  Controller,
  Get,
  Post,
  Headers,
  Param,
  Query,
  Req,
  Res,
  Body,
  HttpCode,
  StreamableFile,
  HttpException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { RequirePermission, VideoUpload } from '../authorization/route-policy.js';
import type { StaffRequest, StaffResponse } from '../identity/http.types.js';
import { uuid } from './catalog.validation.js';
import { videoVersion, videoAction, videoPage, videoRange } from './video.validation.js';
import { CatalogVideoService } from './video.service.js';
@Controller('api/v1/catalog')
export class CatalogVideoController {
  constructor(private readonly service: CatalogVideoService) {}
  @Get('products/:id/videos') @RequirePermission('catalog.read') list(
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    const p = videoPage(q);
    return this.service.list(uuid(id, 'product'), p.page, p.removed);
  }
  @Get('videos/:id/history') @RequirePermission('catalog.read') history(
    @Param('id') id: string,
    @Query() q: unknown,
  ) {
    return this.service.history(uuid(id, 'video'), videoPage(q).page);
  }
  @Post('products/:id/videos') @VideoUpload() @RequirePermission('catalog.manage') upload(
    @Param('id') id: string,
    @Headers('x-product-version') v: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    return this.service.upload(
      uuid(id, 'product'),
      videoVersion(v),
      uuid(key, 'request'),
      req.principal!.id,
      req,
      res,
    );
  }
  @Post('videos/:id') @HttpCode(200) @RequirePermission('catalog.manage') action(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    const input = videoAction(b);
    if (['approve', 'revoke'].includes(String(input.action)))
      throw new HttpException({ code: 'VIDEO_INVALID' }, 400);
    return this.service.action(
      uuid(id, 'video'),
      input,
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
  @Post('videos/:id/review') @HttpCode(200) @RequirePermission('catalog.media.review') review(
    @Param('id') id: string,
    @Body() b: unknown,
    @Headers('x-idempotency-key') key: unknown,
    @Req() req: StaffRequest,
  ) {
    const input = videoAction(b);
    if (!['approve', 'revoke'].includes(String(input.action)))
      throw new HttpException({ code: 'VIDEO_INVALID' }, 400);
    return this.service.action(
      uuid(id, 'video'),
      input,
      uuid(key, 'request'),
      req.principal!.id,
      req.requestId,
    );
  }
  @Get('videos/:id/original') @RequirePermission('catalog.manage') async original(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    const file = await this.service.file(uuid(id, 'video'), 'original', res);
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="' + id + '.' + file.extension + '"',
    );
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    return new StreamableFile(file.bytes, { length: file.bytes.length });
  }
  @Get('videos/:id/:size') @RequirePermission('catalog.read') async file(
    @Param('id') id: string,
    @Param('size') size: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    if (!['playback', 'poster'].includes(size)) throw new HttpException('Not found', 404);
    const file = await this.service.file(uuid(id, 'video'), size as 'playback' | 'poster', res),
      r = videoRange(size === 'playback' ? range : undefined, file.bytes.length);
    res.setHeader('Accept-Ranges', size === 'playback' ? 'bytes' : 'none');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!r) {
      res.setHeader('Content-Range', 'bytes */' + file.bytes.length);
      throw new HttpException('Range not satisfiable', 416);
    }
    res.statusCode = r.status;
    res.setHeader('Content-Type', file.type);
    if (r.status === 206)
      res.setHeader('Content-Range', 'bytes ' + r.start + '-' + r.end + '/' + file.bytes.length);
    return new StreamableFile(file.bytes.subarray(r.start, r.end + 1), {
      length: r.end - r.start + 1,
    });
  }
}
