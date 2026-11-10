import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { accessInput, accessQuery } from '../src/modules/staff-access/access.validation.js';
test('access requests reject credentials, owner impersonation fields, invalid scopes and duplicate assignments', () => {
  const b = {
    kind: 'staff',
    id: randomUUID(),
    expectedVersion: 0,
    displayName: ' Store team ',
    active: true,
    reason: ' Assign stock access ',
    assignments: [{ roleId: randomUUID(), locationId: null }],
  };
  assert.equal(accessInput(b).displayName, 'Store team');
  for (const x of [
    { ...b, password: 'secret' },
    { ...b, isOwner: true },
    { ...b, expectedVersion: -1 },
    { ...b, assignments: [...b.assignments, ...b.assignments] },
    { ...b, assignments: [{ roleId: randomUUID() }] },
    { ...b, reason: '\n' },
    { ...b, active: 'true' },
  ])
    assert.throws(() => accessInput(x));
});
test('role permission requests are canonical and bounded; query limits and unknown keys fail closed', () => {
  const b = {
    kind: 'role',
    id: randomUUID(),
    expectedVersion: 0,
    code: 'warehouse_team',
    label: 'Warehouse team',
    active: true,
    reason: 'Prepare duties',
    permissions: ['inventory.read', 'inventory.receive'],
  };
  assert.deepEqual(accessInput(b).permissions, ['inventory.read', 'inventory.receive']);
  for (const x of [
    { ...b, permissions: ['inventory.read', 'inventory.read'] },
    { ...b, code: 'Owner Access' },
    { ...b, label: 'bad\nname' },
    { ...b, permissions: ['__proto__'] },
    { ...b, assignments: [] },
  ])
    assert.throws(() => accessInput(x));
  assert.deepEqual(accessQuery({ search: ' Shirts ', page: '2' }), { search: 'Shirts', page: 2 });
  assert.throws(() => accessQuery({ page: '0' }));
  assert.throws(() => accessQuery({ limit: '100000' }));
});
