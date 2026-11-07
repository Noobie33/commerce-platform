import { Controller, Get, Res, ServiceUnavailableException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Public } from '../authorization/route-policy.js';
import type { StaffResponse } from '../identity/http.types.js';

export const ADMIN_ASSET_ROOT = fileURLToPath(
  new URL('../../../public/admin/assets/', import.meta.url),
);
const INDEX_FILE = fileURLToPath(new URL('../../../public/admin/index.html', import.meta.url));

@Public()
@Controller()
export class AdminController {
  @Get(['/', '/admin'])
  async index(@Res({ passthrough: true }) response: StaffResponse): Promise<string> {
    let html: string;
    try {
      html = await readFile(INDEX_FILE, 'utf8');
    } catch {
      throw new ServiceUnavailableException('The workspace interface is not built yet');
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    return html;
  }
}
