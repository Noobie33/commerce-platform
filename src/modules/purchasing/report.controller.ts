import { Controller, Get, Header, Param, Query, Req, Res } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-policy.js';
import type { StaffRequest, StaffResponse } from '../identity/http.types.js';
import { uuid } from './purchasing.validation.js';
import { agingQuery, statementQuery } from './report.validation.js';
import { PayablesReportService } from './report.service.js';
import { statementCsv } from './report.csv.js';
@Controller('api/v1/payables')
export class PayablesReportController {
  constructor(private readonly reports: PayablesReportService) {}
  @Get('reports/aging')
  @RequirePermission('payables.read')
  @Header('Cache-Control', 'no-store')
  aging(@Query() q: unknown, @Req() req: StaffRequest) {
    return this.reports.aging(agingQuery(q), req.principal!);
  }
  @Get('suppliers/:id/statement')
  @RequirePermission('payables.read')
  @Header('Cache-Control', 'no-store')
  statement(@Param('id') id: string, @Query() q: unknown, @Req() req: StaffRequest) {
    return this.reports.statement(uuid(id), statementQuery(q), req.principal!);
  }
  @Get('suppliers/:id/statement.csv')
  @RequirePermission('payables.read')
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(
    @Param('id') id: string,
    @Query() q: unknown,
    @Req() req: StaffRequest,
    @Res({ passthrough: true }) res: StaffResponse,
  ) {
    const report = await this.reports.statement(
      uuid(id),
      statementQuery(q, true),
      req.principal!,
      true,
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="supplier-statement-' +
        report.supplier.code +
        '-' +
        report.to +
        '.csv"',
    );
    return statementCsv(report);
  }
}
