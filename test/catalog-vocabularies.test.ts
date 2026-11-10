import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentProfilesV1 } from '../src/database/migrations/content-profiles-v1.js';
import {
  guidedContentProfilesV1,
  materialGroupsV1,
  occasionCodesV1,
} from '../src/database/catalog-vocabularies-v1.js';
test('guided profiles preserve legacy meanings and bound category-specific dropdown choices', () => {
  assert.equal(guidedContentProfilesV1.length, 3);
  for (const [i, p] of guidedContentProfilesV1.entries()) {
    assert.ok(p.code.endsWith('-v2'));
    assert.ok(Object.keys(p.fields).length <= 12);
    assert.equal(p.fields.materialGroup.required, true);
    assert.equal(Object.hasOwn(p.fields.occasion, 'required'), false);
    assert.ok(
      p.fields.materialGroup.options.every((x) =>
        (materialGroupsV1 as readonly string[]).includes(x),
      ),
    );
    assert.ok(p.fields.occasion.options.every((x) => occasionCodesV1.includes(x)));
    assert.equal('materialGroup' in contentProfilesV1[i]!.fields, false);
    assert.equal(p.fields.material.kind, 'text');
    assert.equal(p.fields.material.required, true);
  }
  assert.equal(guidedContentProfilesV1[0]!.fields.materialGroup.options.includes('metal'), false);
  assert.equal(
    (guidedContentProfilesV1[2]!.fields.occasion.options as readonly string[]).includes('gifting'),
    true,
  );
});
