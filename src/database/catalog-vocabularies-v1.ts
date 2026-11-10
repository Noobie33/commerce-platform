// Schema 22 vocabulary meanings are immutable after release. Extend through a new version.
import { contentProfilesV1 } from './migrations/content-profiles-v1.js';
export const clothingMaterialsV1 = [
  'cotton',
  'cotton_blend',
  'linen',
  'linen_blend',
  'silk',
  'silk_blend',
  'viscose',
  'wool',
  'wool_blend',
  'polyester',
  'nylon',
  'mixed',
  'other',
] as const;
export const materialGroupsV1 = [
  ...clothingMaterialsV1,
  'leather',
  'faux_leather',
  'jute',
  'bamboo',
  'wood',
  'metal',
  'glass',
  'ceramic',
  'paper',
  'plastic',
] as const;
export const wearableOccasionsV1 = [
  'everyday',
  'work',
  'festive',
  'formal',
  'active',
  'lounge',
  'other',
] as const;
export const lifestyleOccasionsV1 = ['everyday', 'festive', 'gifting', 'other'] as const;
export const occasionCodesV1 = [
  ...new Set([...wearableOccasionsV1, ...lifestyleOccasionsV1]),
] as readonly string[];
export const guidedContentProfilesV1 = contentProfilesV1.map((p) => ({
  code: p.code.replace('-v1', '-v2'),
  label: p.label + ' - guided fields (v2)',
  fields: {
    ...p.fields,
    material: { ...p.fields.material, label: 'Material / composition details' },
    materialGroup: {
      label: 'Material group',
      kind: 'choice',
      required: true,
      options: p.code === 'clothing-v1' ? [...clothingMaterialsV1] : [...materialGroupsV1],
    },
    occasion: {
      label: 'Occasion',
      kind: 'choice',
      options: p.code === 'lifestyle-v1' ? [...lifestyleOccasionsV1] : [...wearableOccasionsV1],
    },
  },
}));
