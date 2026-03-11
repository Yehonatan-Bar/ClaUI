# Image Lightbox

Full-screen overlay for viewing images at their natural size. Triggered by double-clicking any image in the webview.

## What It Does

Users paste images into the chat input but can only see them as tiny 64x64 thumbnails. Images in message bubbles are capped at 400px. The lightbox lets users double-click any image to see it full-size in a dark overlay.

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/ImageLightbox/ImageLightbox.tsx` | Lightbox overlay component (portal-based) |
| `src/webview/components/ImageLightbox/index.ts` | Barrel export |
| `src/webview/state/store.ts` | `lightboxImageSrc` state field + `setLightboxImageSrc` setter |
| `src/webview/App.tsx` | Mounts `<ImageLightbox />` at app root |
| `src/webview/components/ChatView/MessageBubble.tsx` | `onDoubleClick` on `ImageBlockRenderer` img |
| `src/webview/components/InputArea/InputArea.tsx` | `onDoubleClick` on pending image thumbnails |
| `src/webview/styles/global.css` | `.image-lightbox-overlay` styles + `cursor: zoom-in` |

## How It Works

1. **Store**: `lightboxImageSrc: string | null` in Zustand. When non-null, lightbox renders.
2. **Trigger**: `onDoubleClick` on `<img>` elements calls `setLightboxImageSrc(dataUri)` via `useAppStore.getState()`.
3. **Overlay**: `ImageLightbox` reads the store field. When non-null, renders a fixed overlay via `createPortal` to `document.body`.
4. **Close**: Click on backdrop or press Escape sets `lightboxImageSrc` to `null`.

## CSS

- `.image-lightbox-overlay`: `position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.85)`
- `.image-lightbox-overlay img`: `max-width: 90vw; max-height: 90vh; object-fit: contain`
- `.message-image img, .pending-image-thumb img`: `cursor: zoom-in`

## Accessibility

- `role="dialog"` and `aria-label="Image preview"` on the overlay
- Escape key closes the lightbox
- `cursor: zoom-in` on images, `cursor: zoom-out` on overlay backdrop
