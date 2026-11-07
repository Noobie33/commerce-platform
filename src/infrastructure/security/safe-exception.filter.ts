import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>();
    let status = 500;
    let body: unknown = { statusCode: 500, message: 'Internal server error' };
    const type = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    if (type === 'entity.parse.failed') {
      status = 400;
      body = { statusCode: status, message: 'Invalid JSON request' };
    } else if (type === 'entity.too.large') {
      status = 413;
      body = { statusCode: status, message: 'Request body too large' };
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const payload = error.getResponse();
      body = typeof payload === 'string' ? { statusCode: status, message: payload } : payload;
    }
    response.status(status).json(body);
  }
}
