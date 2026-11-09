export const contentProfilesV1 = [
  {
    code: 'clothing-v1',
    label: 'Clothing',
    fields: {
      material: { label: 'Fabric / material', kind: 'text', max: 180, required: true },
      care: { label: 'Care instructions', kind: 'text', max: 600, required: true },
      fit: {
        label: 'Fit',
        kind: 'choice',
        options: ['regular', 'slim', 'relaxed', 'oversized', 'not_applicable'],
        required: true,
      },
      neckline: { label: 'Neckline', kind: 'text', max: 80 },
      sleeves: { label: 'Sleeves', kind: 'text', max: 80 },
      finish: { label: 'Finish / details', kind: 'text', max: 180 },
      garmentLengthCm: { label: 'Garment length (cm)', kind: 'decimal' },
    },
  },
  {
    code: 'accessories-v1',
    label: 'Accessories',
    fields: {
      material: { label: 'Material', kind: 'text', max: 180, required: true },
      care: { label: 'Care instructions', kind: 'text', max: 600, required: true },
      finish: { label: 'Finish / details', kind: 'text', max: 180 },
      widthCm: { label: 'Width (cm)', kind: 'decimal' },
      heightCm: { label: 'Height (cm)', kind: 'decimal' },
      depthCm: { label: 'Depth (cm)', kind: 'decimal' },
    },
  },
  {
    code: 'lifestyle-v1',
    label: 'Lifestyle',
    fields: {
      material: { label: 'Material', kind: 'text', max: 180, required: true },
      care: { label: 'Care instructions', kind: 'text', max: 600, required: true },
      finish: { label: 'Finish / details', kind: 'text', max: 180 },
      widthCm: { label: 'Width (cm)', kind: 'decimal' },
      heightCm: { label: 'Height (cm)', kind: 'decimal' },
      depthCm: { label: 'Depth (cm)', kind: 'decimal' },
      weightGrams: { label: 'Weight (g)', kind: 'decimal' },
    },
  },
] as const;
