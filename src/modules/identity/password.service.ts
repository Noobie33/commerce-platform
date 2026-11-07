import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const PROFILE = 'scrypt$32768$8$3$';
const FORMAT = /^scrypt\$32768\$8\$3\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

export class PasswordService {
  private active = 0;

  private async derive(password: string, salt: Buffer): Promise<Buffer> {
    if (this.active >= 2) throw new ServiceUnavailableException('Authentication temporarily busy');
    this.active++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(
          password.normalize('NFC'),
          salt,
          32,
          { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, key) => (error ? reject(error) : resolve(key)),
        );
      });
    } finally {
      this.active--;
    }
  }

  async hash(password: string): Promise<string> {
    const length = [...password.normalize('NFC')].length;
    if (length < 15 || length > 128)
      throw new BadRequestException('Password must contain 15 to 128 characters');
    const salt = randomBytes(16);
    const key = await this.derive(password, salt);
    return PROFILE + salt.toString('base64url') + '$' + key.toString('base64url');
  }

  async verify(password: string, encoded?: string): Promise<boolean> {
    const match = encoded?.match(FORMAT);
    // Unknown users and malformed stored hashes still perform the same fixed-cost work.
    const salt = match ? Buffer.from(match[1]!, 'base64url') : Buffer.alloc(16);
    const expected = match ? Buffer.from(match[2]!, 'base64url') : Buffer.alloc(32);
    const actual = await this.derive(password, salt);
    return !!match && timingSafeEqual(actual, expected);
  }
}
