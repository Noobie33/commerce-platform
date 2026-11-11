'use client';
import { useId, useRef } from 'react';
import type { SizeGuide as Guide } from '../lib/catalog-contract';
import { Icon } from './icon';
export function SizeGuide({ guide: g, productName }: { guide: Guide; productName: string }) {
  const dialog = useRef<HTMLDialogElement>(null),
    id = useId();
  return (
    <>
      <button
        type="button"
        className="size-guide-trigger"
        onClick={() => dialog.current?.showModal()}
      >
        Size Guide
        <Icon name="chevron" />
      </button>
      <dialog
        ref={dialog}
        className="size-guide-drawer"
        aria-labelledby={id}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <header className="size-guide-drawer-heading">
          <h2 id={id}>SIZE GUIDE</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="Close size guide"
            onClick={() => dialog.current?.close()}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="size-guide">
          <p className="size-guide-product">{productName}</p>
          <p className="size-guide-convention">
            {g.basis === 'garment' ? 'Garment' : 'Body'} measurements in{' '}
            {g.unit === 'cm' ? 'centimetres (cm)' : 'inches (in)'}
          </p>
          {g.instructions && <p className="size-guide-instructions">{g.instructions}</p>}
          <div
            className="size-guide-scroll"
            tabIndex={0}
            role="region"
            aria-label="Size guide measurements"
          >
            <table>
              <caption>{g.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Size</th>
                  {g.columns.map((c) => (
                    <th scope="col" key={c}>
                      {c} ({g.unit})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.size}>
                    <th scope="row">{r.size}</th>
                    {r.values.map((v, i) => (
                      <td key={g.columns[i]}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </dialog>
    </>
  );
}
