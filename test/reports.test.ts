import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../src/modules/purchasing/report.csv.js';
import { reportMoney } from '../src/modules/purchasing/report.service.js';
import { money } from '../apps/admin/src/purchasing/money.js';
test('report CSV quotes preserve Bengali and embedded data while neutralizing formula entry points', () => {
  for (const cell of [
    '=1+1',
    '+SUM(1,2)',
    '-1+2',
    '@command',
    '  =1',
    '\tvalue',
    '\rvalue',
    '\nvalue',
    '\ufeff=1',
  ])
    assert.ok(csvCell(cell).startsWith('"\''));
  assert.equal(csvCell('বাংলা, "shirt"\ncare'), '"বাংলা, ""shirt""\ncare"');
  assert.equal(csvCell('1000.01'), '"1000.01"');
});
test('report formatting preserves signed cents and large exact amounts in API and staff UI', () => {
  assert.equal(reportMoney('-1'), '-0.01');
  assert.equal(reportMoney('-101'), '-1.01');
  assert.equal(reportMoney('99999999999999'), '999999999999.99');
  assert.equal(reportMoney('0'), '0.00');
  assert.equal(money('-0.01'), '-৳0.01');
  assert.equal(money('-1000.01'), '-৳1,000.01');
});
