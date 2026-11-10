import {
  Controller,
  Get,
  Param,
  Headers,
  Res,
  StreamableFile,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { Public } from '../authorization/route-policy.js';
import { GalleryReleaseService } from './gallery-release.service.js';
import { videoRange } from './video.validation.js';
@Controller('api/v1/store/products/:slug/media/:version/:id')
export class GalleryPublicController {
  constructor(private readonly gallery: GalleryReleaseService) {}
  @Get(':size') @Public() async media(
    @Param('slug') slug: string,
    @Param('version') version: string,
    @Param('id') id: string,
    @Param('size') size: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    if (
      slug.length > 120 ||
      !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
      !/^[1-9][0-9]{0,9}$/.test(version) ||
      Number(version) > 2147483646 ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id) ||
      !['playback', 'poster'].includes(size)
    )
      throw new NotFoundException();
    const bytes = await this.gallery.publicVideo(
        slug,
        Number(version),
        id,
        size as 'playback' | 'poster',
        res,
      ),
      r = videoRange(size === 'playback' ? range : undefined, bytes.length);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Accept-Ranges', size === 'playback' ? 'bytes' : 'none');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (!r) {
      res.setHeader('Content-Range', 'bytes */' + bytes.length);
      throw new HttpException('Range not satisfiable', 416);
    }
    res.statusCode = r.status;
    res.setHeader('Content-Type', size === 'playback' ? 'video/mp4' : 'image/webp');
    if (r.status === 206)
      res.setHeader('Content-Range', 'bytes ' + r.start + '-' + r.end + '/' + bytes.length);
    return new StreamableFile(bytes.subarray(r.start, r.end + 1), { length: r.end - r.start + 1 });
  }
}
