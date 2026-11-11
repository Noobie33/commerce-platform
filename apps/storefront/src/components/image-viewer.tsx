'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Media } from '../lib/catalog-contract';
import { Icon } from './icon';
export function ImageViewer({
  photo,
  onClose,
  onUnavailable,
}: {
  photo: Media;
  onClose: () => void;
  onUnavailable: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    viewport = useRef<HTMLDivElement>(null),
    drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null),
    [box, setBox] = useState({ w: 0, h: 0 }),
    [zoom, setZoom] = useState<number | null>(null);
  const fit =
      box.w && box.h
        ? Math.min(1, Math.max(1, box.w - 32) / photo.width, Math.max(1, box.h - 32) / photo.height)
        : 1,
    scale = zoom === null ? fit : Math.max(fit, Math.min(1, zoom));
  useLayoutEffect(() => {
    const d = dialog.current,
      v = viewport.current;
    if (!d || !v) return;
    d.showModal();
    const measure = () => setBox({ w: v.clientWidth, h: v.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(v);
    return () => {
      observer.disconnect();
      d.close();
    };
  }, []);
  useLayoutEffect(() => {
    const v = viewport.current;
    if (v) {
      v.scrollLeft = (v.scrollWidth - v.clientWidth) / 2;
      v.scrollTop = (v.scrollHeight - v.clientHeight) / 2;
    }
  }, [scale, box.w, box.h]);
  const change = (by: number) => setZoom(Math.min(1, Math.max(fit, scale + by)));
  return (
    <dialog
      className="image-viewer"
      ref={dialog}
      aria-labelledby="image-viewer-title"
      onClose={(e) => {
        if (e.target === dialog.current && !dialog.current?.open) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          change(0.25);
        }
        if (e.key === '-') {
          e.preventDefault();
          change(-0.25);
        }
        if (e.key === '0') {
          e.preventDefault();
          setZoom(null);
        }
      }}
    >
      <header className="image-viewer-toolbar">
        <h2 id="image-viewer-title">Product photo</h2>
        <div className="image-zoom-controls">
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom out"
            disabled={scale <= fit + 0.001}
            onClick={() => change(-0.25)}
          >
            -
          </button>
          <output aria-live="polite">{Math.round(scale * 100)}%</output>
          <button
            type="button"
            className="icon-button"
            aria-label="Zoom in"
            disabled={scale >= 0.999}
            onClick={() => change(0.25)}
          >
            +
          </button>
          <button type="button" className="zoom-fit" onClick={() => setZoom(null)}>
            Fit
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Close photo viewer"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <div
        className="image-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Zoomed photo. Scroll or drag to move."
        onPointerDown={(e) => {
          if (
            e.pointerType === 'mouse' &&
            e.button === 0 &&
            scale > fit + 0.001 &&
            viewport.current
          ) {
            e.preventDefault();
            drag.current = {
              x: e.clientX,
              y: e.clientY,
              left: viewport.current.scrollLeft,
              top: viewport.current.scrollTop,
            };
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerMove={(e) => {
          if (drag.current && viewport.current) {
            viewport.current.scrollLeft = drag.current.left + drag.current.x - e.clientX;
            viewport.current.scrollTop = drag.current.top + drag.current.y - e.clientY;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="image-zoom-stage"
          style={{
            width: Math.max(box.w, photo.width * scale + 32),
            height: Math.max(box.h, photo.height * scale + 32),
          }}
        >
          <img
            src={photo.url}
            alt={photo.label}
            width={photo.width}
            height={photo.height}
            draggable={false}
            style={{ width: photo.width * scale, height: photo.height * scale }}
            onError={() => {
              onClose();
              onUnavailable();
            }}
          />
        </div>
      </div>
      <footer className="image-viewer-caption">
        {photo.label}
        <span>Zoom is limited to the display image's actual pixels.</span>
      </footer>
    </dialog>
  );
}
