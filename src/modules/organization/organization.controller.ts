import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import { OrganizationService } from './organization.service.js';

@Controller('api/v1/locations')
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}
  @RequirePermission('locations.read', 'locationId')
  @Get(':locationId')
  location(@Param('locationId') id: string) {
    return this.organization.location(id);
  }
}
