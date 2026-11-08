import {
  BadRequestException,
  PayloadTooLargeException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { StaffRequest, StaffResponse } from '../../modules/identity/http.types.js';
import { MAX_IMAGE_BYTES } from './image-processor.js';
/** Called after the Nest guard has verified session, scope, CSRF and upload content type. */
export function readImageBody(req: StaffRequest, res: StaffResponse): Promise<Buffer> {
  const length = req.headers['content-length'];
  if (length === '0') throw new BadRequestException('Choose a product image');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')
    throw new BadRequestException('Encoded image requests are not supported');
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_IMAGE_BYTES)) {
    res.setHeader('Connection', 'close');
    throw new PayloadTooLargeException('Image exceeds 5 MB');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data);
      req.off('end', end);
      req.off('error', error);
      req.off('aborted', aborted);
    };
    const fail = (reason: Error) => {
      cleanup();
      res.setHeader('Connection', 'close');
      req.resume();
      reject(reason);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        fail(new PayloadTooLargeException('Image exceeds 5 MB'));
        return;
      }
      chunks.push(chunk);
    };
    const end = () => {
      cleanup();
      if (!size) {
        reject(new BadRequestException('Choose a product image'));
        return;
      }
      resolve(Buffer.concat(chunks, size));
    };
    const error = () => fail(new BadRequestException('Image upload did not complete'));
    const aborted = () => fail(new BadRequestException('Image upload did not complete'));
    const timer = setTimeout(
      () => fail(new RequestTimeoutException('Image upload timed out')),
      15000,
    );
    timer.unref();
    req.on('data', data);
    req.once('end', end);
    req.once('error', error);
    req.once('aborted', aborted);
  });
}
