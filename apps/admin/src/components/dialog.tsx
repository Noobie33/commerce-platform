import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../icons';

export function Dialog({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const node = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    node.showModal();
    document.body.classList.add('dialog-open');
    node.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return () => {
      node.close();
      if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={'workspace-dialog' + (wide ? ' dialog-wide' : '')}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          onClose();
      }}
    >
      <header className="dialog-header">
        <div>
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose} type="button">
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
