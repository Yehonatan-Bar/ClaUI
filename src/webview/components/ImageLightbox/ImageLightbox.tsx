import React, { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../state/store';

/**
 * Full-screen lightbox overlay for viewing images at their natural size.
 * Triggered by double-clicking any image (pending thumbnails or message images).
 * Closes on backdrop click or Escape key.
 */
export const ImageLightbox: React.FC = () => {
  const lightboxImageSrc = useAppStore((s) => s.lightboxImageSrc);
  const setLightboxImageSrc = useAppStore((s) => s.setLightboxImageSrc);

  const close = useCallback(() => setLightboxImageSrc(null), [setLightboxImageSrc]);

  useEffect(() => {
    if (!lightboxImageSrc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImageSrc, close]);

  if (!lightboxImageSrc) return null;

  return createPortal(
    <div
      className="image-lightbox-overlay"
      role="dialog"
      aria-label="Image preview"
      onClick={close}
    >
      <img
        src={lightboxImageSrc}
        alt="Enlarged preview"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body
  );
};
