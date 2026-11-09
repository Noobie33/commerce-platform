import type { MerchItem, MerchSnapshot, GuideDefinition } from './merch-types';
export function MerchDetails({ item }: { item: MerchItem | MerchSnapshot }) {
  const d = item.definition;
  return (
    <section className="merch-preview">
      <h3>
        {d.title} <small>v{item.version}</small>
      </h3>
      {item.kind === 'collection' ? (
        <p>{'description' in d ? d.description : ''}</p>
      ) : (
        <>
          <p>
            {(d as GuideDefinition).basis === 'body' ? 'Body measurements' : 'Garment measurements'}{' '}
            / {(d as GuideDefinition).unit === 'cm' ? 'centimetres (cm)' : 'inches (in)'}
          </p>
          <p className="merch-copy">{(d as GuideDefinition).instructions}</p>
          <div
            className="merch-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Size guide measurements"
          >
            <table>
              <caption>{d.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Size</th>
                  {(d as GuideDefinition).columns.map((x, i) => (
                    <th scope="col" key={i}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(d as GuideDefinition).rows.map((r, i) => (
                  <tr key={i}>
                    <th scope="row">{r.size}</th>
                    {r.values.map((v, j) => (
                      <td key={j}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
