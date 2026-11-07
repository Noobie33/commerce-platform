import { NotFoundException } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export class OrganizationService {
  constructor(private readonly source: DataSource) {}
  async location(id: string) {
    const rows: { id: string; code: string; name: string }[] = await this.source.query(
      'SELECT id,code,name FROM locations WHERE id=$1 AND is_active',
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Location not found');
    return rows[0];
  }
}
