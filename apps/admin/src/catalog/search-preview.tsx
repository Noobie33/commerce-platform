import type { SeoInput } from './presentation-types';
export function SearchPreview({
  name,
  path,
  description,
  seo,
}: {
  name: string;
  path: string;
  description: string;
  seo: SeoInput;
}) {
  return (
    <section className="search-preview" aria-label="Illustrative search preview">
      <span>{path}</span>
      <h4>{seo.title || name || 'Page title'}</h4>
      <p>
        {seo.description ||
          description ||
          'Add useful page content or an optional search description.'}
      </p>
      <small>Illustration only. Search engines may choose different text.</small>
    </section>
  );
}
export function SeoFields({
  value,
  onChange,
}: {
  value: SeoInput;
  onChange: (seo: SeoInput) => void;
}) {
  return (
    <>
      <label className="content-full">
        Search title
        <input
          maxLength={80}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
        <small>Optional. The page name is used when blank. {value.title.length}/80</small>
      </label>
      <label className="content-full">
        Search description
        <textarea
          rows={3}
          maxLength={320}
          value={value.description}
          onChange={(e) => onChange({ ...value, description: e.target.value })}
        />
        <small>Optional, concise page summary. {value.description.length}/320</small>
      </label>
    </>
  );
}
