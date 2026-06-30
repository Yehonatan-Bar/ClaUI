import React, { useEffect, useCallback, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../state/store';

type Tool = 'pencil' | 'rect' | 'arrow';

type PencilShape = { type: 'pencil'; color: string; points: Array<[number, number]> };
type RectShape = { type: 'rect'; color: string; x1: number; y1: number; x2: number; y2: number };
type ArrowShape = { type: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number };
type Shape = PencilShape | RectShape | ArrowShape;

const COLORS = ['#ff3a3a', '#ffd23f', '#3df03d', '#3d9bff', '#ffffff'];
const STROKE_WIDTH = 3;
const ARROW_HEAD_LEN = 14;

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - ARROW_HEAD_LEN * Math.cos(angle - Math.PI / 6),
    y2 - ARROW_HEAD_LEN * Math.sin(angle - Math.PI / 6),
  );
  ctx.lineTo(
    x2 - ARROW_HEAD_LEN * Math.cos(angle + Math.PI / 6),
    y2 - ARROW_HEAD_LEN * Math.sin(angle + Math.PI / 6),
  );
  ctx.closePath();
  ctx.fill();
}

const DrawingCanvas: React.FC<{
  tool: Tool;
  color: string;
  shapes: Shape[];
  setShapes: React.Dispatch<React.SetStateAction<Shape[]>>;
  width: number;
  height: number;
}> = ({ tool, color, shapes, setShapes, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState<Shape | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const all = drawing ? [...shapes, drawing] : shapes;
    for (const s of all) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      if (s.type === 'pencil') {
        if (s.points.length === 0) continue;
        ctx.beginPath();
        const [x0, y0] = s.points[0];
        ctx.moveTo(x0 * width, y0 * height);
        for (let i = 1; i < s.points.length; i++) {
          const [x, y] = s.points[i];
          ctx.lineTo(x * width, y * height);
        }
        ctx.stroke();
      } else if (s.type === 'rect') {
        ctx.strokeRect(
          s.x1 * width,
          s.y1 * height,
          (s.x2 - s.x1) * width,
          (s.y2 - s.y1) * height,
        );
      } else {
        drawArrow(ctx, s.x1 * width, s.y1 * height, s.x2 * width, s.y2 * height);
      }
    }
  }, [shapes, drawing, width, height]);

  const ratioFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    const { x, y } = ratioFromEvent(e);
    if (tool === 'pencil') {
      setDrawing({ type: 'pencil', color, points: [[x, y]] });
    } else if (tool === 'rect') {
      setDrawing({ type: 'rect', color, x1: x, y1: y, x2: x, y2: y });
    } else {
      setDrawing({ type: 'arrow', color, x1: x, y1: y, x2: x, y2: y });
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = ratioFromEvent(e);
    setDrawing((prev) => {
      if (!prev) return prev;
      if (prev.type === 'pencil') {
        return { ...prev, points: [...prev.points, [x, y]] };
      }
      return { ...prev, x2: x, y2: y };
    });
  };

  const finishDrawing = () => {
    setDrawing((prev) => {
      if (prev) setShapes((all) => [...all, prev]);
      return null;
    });
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="image-lightbox-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrawing}
      onPointerCancel={finishDrawing}
    />
  );
};

/**
 * Full-screen lightbox overlay for viewing images at their natural size.
 * Single-click any image to open. Includes a basic drawing toolbar
 * (pencil, rectangle, arrow) for marking up the image. Closes on backdrop
 * click or Escape key.
 */
export const ImageLightbox: React.FC = () => {
  const lightboxImageSrc = useAppStore((s) => s.lightboxImageSrc);
  const setLightboxImageSrc = useAppStore((s) => s.setLightboxImageSrc);

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  shapesRef.current = shapes;

  const close = useCallback(() => {
    const currentShapes = shapesRef.current;
    const onSave = useAppStore.getState().lightboxOnSave;
    if (onSave && currentShapes.length > 0) {
      const img = imgRef.current;
      if (img && img.complete) {
        const w = img.naturalWidth || img.offsetWidth;
        const h = img.naturalHeight || img.offsetHeight;
        if (w && h) {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            try { ctx.drawImage(img, 0, 0, w, h); } catch { /* noop */ }
            ctx.lineWidth = STROKE_WIDTH;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const s of currentShapes) {
              ctx.strokeStyle = s.color;
              ctx.fillStyle = s.color;
              if (s.type === 'pencil') {
                if (s.points.length === 0) continue;
                ctx.beginPath();
                ctx.moveTo(s.points[0][0] * w, s.points[0][1] * h);
                for (let i = 1; i < s.points.length; i++) {
                  ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h);
                }
                ctx.stroke();
              } else if (s.type === 'rect') {
                ctx.strokeRect(s.x1 * w, s.y1 * h, (s.x2 - s.x1) * w, (s.y2 - s.y1) * h);
              } else {
                drawArrow(ctx, s.x1 * w, s.y1 * h, s.x2 * w, s.y2 * h);
              }
            }
            const dataUri = canvas.toDataURL('image/png');
            onSave(dataUri);
          }
        }
      }
    }
    useAppStore.getState().setLightboxOnSave(null);
    setLightboxImageSrc(null);
  }, [setLightboxImageSrc]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 1500);
  }, []);

  // Render the image plus all shapes onto an off-screen canvas at natural
  // resolution and copy the result as a PNG blob to the system clipboard.
  const copyImageWithShapes = useCallback(async (): Promise<boolean> => {
    const img = imgRef.current;
    if (!img || !img.complete) return false;
    const w = img.naturalWidth || img.offsetWidth;
    const h = img.naturalHeight || img.offsetHeight;
    if (!w || !h) return false;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    try {
      ctx.drawImage(img, 0, 0, w, h);
    } catch {
      return false;
    }

    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of shapes) {
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      if (s.type === 'pencil') {
        if (s.points.length === 0) continue;
        ctx.beginPath();
        const [x0, y0] = s.points[0];
        ctx.moveTo(x0 * w, y0 * h);
        for (let i = 1; i < s.points.length; i++) {
          const [x, y] = s.points[i];
          ctx.lineTo(x * w, y * h);
        }
        ctx.stroke();
      } else if (s.type === 'rect') {
        ctx.strokeRect(s.x1 * w, s.y1 * h, (s.x2 - s.x1) * w, (s.y2 - s.y1) * h);
      } else {
        drawArrow(ctx, s.x1 * w, s.y1 * h, s.x2 * w, s.y2 * h);
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });
    if (!blob) return false;

    try {
      const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (!ClipboardItemCtor || !navigator.clipboard?.write) return false;
      await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
      return true;
    } catch {
      return false;
    }
  }, [shapes]);

  const handleCopy = useCallback(async () => {
    setCtxMenu(null);
    const ok = await copyImageWithShapes();
    showToast(ok ? 'Copied' : 'Copy failed');
  }, [copyImageWithShapes, showToast]);

  useEffect(() => {
    if (!lightboxImageSrc) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (ctxMenu) {
        setCtxMenu(null);
      } else {
        close();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImageSrc, close, ctxMenu]);

  useEffect(() => {
    setSize(null);
    setShapes([]);
    setCtxMenu(null);
    setToast(null);
    if (!lightboxImageSrc) return;
    const img = imgRef.current;
    if (!img) return;
    const update = () => {
      if (img.offsetWidth > 0 && img.offsetHeight > 0) {
        setSize({ w: img.offsetWidth, h: img.offsetHeight });
      }
    };
    if (img.complete) update();
    img.addEventListener('load', update);
    const ro = new ResizeObserver(update);
    ro.observe(img);
    return () => {
      img.removeEventListener('load', update);
      ro.disconnect();
    };
  }, [lightboxImageSrc]);

  const undo = () => setShapes((prev) => prev.slice(0, -1));
  const clear = () => setShapes([]);

  if (!lightboxImageSrc) return null;

  return createPortal(
    <div
      className="image-lightbox-overlay"
      role="dialog"
      aria-label="Image preview"
      onClick={close}
    >
      <div
        className="image-lightbox-toolbar"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={tool === 'pencil' ? 'active' : ''}
          onClick={() => setTool('pencil')}
          title="Free draw"
        >
          Pencil
        </button>
        <button
          className={tool === 'rect' ? 'active' : ''}
          onClick={() => setTool('rect')}
          title="Rectangle"
        >
          Rect
        </button>
        <button
          className={tool === 'arrow' ? 'active' : ''}
          onClick={() => setTool('arrow')}
          title="Arrow"
        >
          Arrow
        </button>
        <span className="divider" />
        {COLORS.map((c) => (
          <button
            key={c}
            className={`color-swatch ${color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`Color ${c}`}
            title={c}
          />
        ))}
        <span className="divider" />
        <button
          onClick={handleCopy}
          title="Copy image (with annotations) to clipboard"
        >
          Copy
        </button>
        <span className="divider" />
        <button
          onClick={undo}
          disabled={shapes.length === 0}
          title="Undo last shape"
        >
          Undo
        </button>
        <button
          onClick={clear}
          disabled={shapes.length === 0}
          title="Clear all shapes"
        >
          Clear
        </button>
      </div>
      <div
        className="image-lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setCtxMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <img
          ref={imgRef}
          src={lightboxImageSrc}
          alt="Enlarged preview"
          draggable={false}
        />
        {size && (
          <DrawingCanvas
            tool={tool}
            color={color}
            shapes={shapes}
            setShapes={setShapes}
            width={size.w}
            height={size.h}
          />
        )}
      </div>
      {ctxMenu && (
        <div
          className="image-lightbox-ctx-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            setCtxMenu(null);
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCtxMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <div
            className="image-lightbox-ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="image-lightbox-ctx-item" onClick={handleCopy} data-tooltip="Copy image with annotations to clipboard">
              Copy image
            </button>
          </div>
        </div>
      )}
      {toast && <div className="image-lightbox-toast">{toast}</div>}
    </div>,
    document.body,
  );
};
