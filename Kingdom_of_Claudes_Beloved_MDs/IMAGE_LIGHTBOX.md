# Image Lightbox

Full-screen overlay for viewing images at their natural size, marking them up with simple shapes, and copying them to the system clipboard.

## What It Does

Users paste images into the chat input but only see them as small thumbnails. The lightbox lets users click any image (in the input pending tray or in a message bubble) to see it full-size in a dark overlay. Inside the overlay they can:

- Draw freehand, rectangles, or arrows on top of the image (annotation toolbar).
- Copy the image (with annotations baked in) to the OS clipboard, either via a Copy button in the toolbar or via right-click -> "Copy image".

## Key Files

| File | Purpose |
|------|---------|
| `src/webview/components/ImageLightbox/ImageLightbox.tsx` | Lightbox overlay component (portal-based), drawing canvas, copy logic, custom right-click menu, toast |
| `src/webview/components/ImageLightbox/index.ts` | Barrel export |
| `src/webview/state/store.ts` | `lightboxImageSrc` state field + `setLightboxImageSrc` setter |
| `src/webview/App.tsx` | Mounts `<ImageLightbox />` at app root |
| `src/webview/components/ChatView/MessageBubble.tsx` | Click handler on `ImageBlockRenderer` img |
| `src/webview/components/InputArea/InputArea.tsx` | Click handler on pending image thumbnails |
| `src/webview/styles/global.css` | `.image-lightbox-*` styles (overlay, toolbar, canvas, ctx menu, toast) |

## How It Works

1. **Store**: `lightboxImageSrc: string | null` in Zustand. When non-null, lightbox renders.
2. **Trigger**: clicking any image calls `setLightboxImageSrc(dataUri)` via `useAppStore.getState()`.
3. **Overlay**: `ImageLightbox` reads the store field. When non-null, renders a fixed overlay via `createPortal` to `document.body`.
4. **Drawing**: a transparent `<canvas>` (`DrawingCanvas`) sits on top of the `<img>` at the same display size. Shapes are stored in normalized 0-1 coordinates so they survive resize. Tools: `pencil`, `rect`, `arrow`. Colors: red, yellow, green, blue, white. Stroke width is fixed (`STROKE_WIDTH = 3`).
5. **Copy**: `copyImageWithShapes()` creates an off-screen canvas at the image's natural resolution, draws the image, then re-renders the shapes at natural scale, exports to a PNG `Blob` via `canvas.toBlob`, and writes to the clipboard with `navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])`.
6. **Right-click menu**: `onContextMenu` on the stage calls `preventDefault()` to suppress VS Code's native menu (which cannot copy images in a webview) and opens a custom menu positioned at the cursor with a single "Copy image" item. The menu has a transparent backdrop that closes the menu on outside click; the backdrop stops click propagation so the lightbox itself stays open.
7. **Toast**: a small "Copied" / "Copy failed" toast appears at the bottom for 1.5s after copy attempts. Driven by `setTimeout` with a ref so repeat clicks restart the timer cleanly.
8. **Close**: click on overlay backdrop or press Escape sets `lightboxImageSrc` to `null`. If the right-click menu is open, Escape closes the menu first instead of the lightbox.

## CSS

- `.image-lightbox-overlay`: `position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,0.85)`
- `.image-lightbox-stage` / `.image-lightbox-overlay img` / `.image-lightbox-canvas`: image + drawing surface positioning
- `.image-lightbox-toolbar`: top-center floating toolbar with tool/color/copy/undo/clear buttons
- `.image-lightbox-ctx-backdrop` / `.image-lightbox-ctx-menu` / `.image-lightbox-ctx-item`: custom right-click menu
- `.image-lightbox-toast` + `@keyframes image-lightbox-toast-fade`: feedback toast
- `.message-image img, .pending-image-thumb img`: `cursor: zoom-in`

## Why a Custom Right-Click Menu

VS Code's webview shows a system context menu on right-click that includes a localized "Copy" entry, but that entry is the editor text-copy command and cannot copy image data (especially `data:` URLs). We can't modify or replace VS Code's menu, so the lightbox suppresses it with `preventDefault()` and renders its own menu that calls the same `handleCopy` path used by the toolbar button.

## Clipboard API Notes

- `navigator.clipboard.write` with `ClipboardItem` is the only reliable way to put image bytes on the OS clipboard from a browser context. It works in the Electron version VS Code ships.
- If the API is unavailable or rejects (permission denied, missing constructor), `copyImageWithShapes()` returns `false` and the toast shows "Copy failed".
- VS Code's `vscode.env.clipboard` API in the extension host only supports text, so this work happens entirely in the webview.

## Accessibility

- `role="dialog"` and `aria-label="Image preview"` on the overlay
- Escape closes the right-click menu first (if open), then the lightbox
- `cursor: zoom-in` on images, `cursor: zoom-out` on overlay backdrop
