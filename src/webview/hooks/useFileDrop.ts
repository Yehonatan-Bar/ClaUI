import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shift+drag-and-drop of files onto the chat panel.
 *
 * VS Code lets drag events reach a webview only while Shift is held: on every
 * drag/dragover without Shift its webview drag monitor sets
 * `pointer-events: none` on the webview iframe, so the editor area takes the
 * drop and opens the file. With Shift the iframe keeps receiving events and the
 * drop lands here. The whole panel is the drop zone (window listeners, capture
 * phase); drags that start inside the webview (tab reordering, text selection)
 * are ignored.
 */

/**
 * DataTransfer types (always lowercase) that mark an external file drag:
 * 'files' = OS file manager, the rest are set by VS Code Explorer / editor tab drags.
 */
const EXTERNAL_FILE_DRAG_TYPES = ['files', 'codefiles', 'resourceurls', 'codeeditors'];
/** Present on drags from VS Code itself, which already carry real paths */
const VSCODE_DRAG_TYPES = ['codefiles', 'resourceurls', 'codeeditors'];

/** Fallback reset when neither dragleave nor drop arrives (e.g. VS Code blocked the iframe mid-drag). */
const DRAG_IDLE_RESET_MS = 1200;
/** A file drag that disappears this fast, without Shift, was taken away by VS Code. */
const BLOCKED_DRAG_WINDOW_MS = 600;
/** Long enough to still be visible after VS Code opened the file in front of the chat and the user came back */
const BLOCKED_DRAG_HINT_MS = 20000;

export interface FileDropPayload {
  /** Absolute paths from VS Code's "CodeFiles" payload (Explorer drags, includes folders) */
  vscodePaths: string[];
  /** Resource URIs from "ResourceURLs" / text/uri-list (Explorer, editor tabs, remote workspaces) */
  vscodeUris: string[];
  /** Files from the OS file manager: the webview gets their contents, never their path */
  osFiles: File[];
  /** Folders dropped from the OS file manager (their contents cannot be read here) */
  osFolderNames: string[];
}

function getLowercaseTypes(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.types ?? []).map((type) => type.toLowerCase());
}

function parseJsonStringArray(raw: string): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** text/uri-list: one URI per line, '#' lines are comments */
function parseUriList(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Must run synchronously inside the drop handler: DataTransfer items expire after the event. */
function extractDropPayload(dataTransfer: DataTransfer): FileDropPayload {
  const types = getLowercaseTypes(dataTransfer);
  const vscodePaths = types.includes('codefiles') ? parseJsonStringArray(dataTransfer.getData('CodeFiles')) : [];
  const vscodeUris = types.includes('resourceurls') || types.includes('codeeditors')
    ? [
        ...parseJsonStringArray(dataTransfer.getData('ResourceURLs')),
        ...parseUriList(dataTransfer.getData('text/uri-list')),
      ]
    : [];

  const osFiles: File[] = [];
  const osFolderNames: string[] = [];
  if (vscodePaths.length === 0 && vscodeUris.length === 0) {
    const items = dataTransfer.items;
    for (let index = 0; index < (items?.length ?? 0); index++) {
      const item = items[index];
      if (item.kind !== 'file') continue;
      const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
      if (entry?.isDirectory) {
        osFolderNames.push(entry.name);
        continue;
      }
      const file = item.getAsFile();
      if (file) osFiles.push(file);
    }
    if (osFiles.length === 0 && osFolderNames.length === 0 && dataTransfer.files) {
      osFiles.push(...Array.from(dataTransfer.files));
    }
  }

  return { vscodePaths, vscodeUris, osFiles, osFolderNames };
}

/** Read a File as base64 (no data: prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      const commaIndex = dataUrl.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error(`could not read ${file.name}`));
        return;
      }
      resolve(dataUrl.slice(commaIndex + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

interface UseFileDropOptions {
  /** When false, file drags are still swallowed but nothing is attached (input disabled). */
  enabled: boolean;
  onDrop: (payload: FileDropPayload) => void;
  /** A drag from the OS file manager entered the panel (fires once per drag, before the drop). */
  onOsFileDragEnter?: () => void;
}

export function useFileDrop({ enabled, onDrop, onOsFileDragEnter }: UseFileDropOptions) {
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [blockedDragHintVisible, setBlockedDragHintVisible] = useState(false);
  const enabledRef = useRef(enabled);
  const onDropRef = useRef(onDrop);
  const onOsFileDragEnterRef = useRef(onOsFileDragEnter);
  enabledRef.current = enabled;
  onDropRef.current = onDrop;
  onOsFileDragEnterRef.current = onOsFileDragEnter;

  useEffect(() => {
    // dragenter/dragleave fire for every child element; the depth tells when the drag left the panel
    let enterDepth = 0;
    let dragEnteredAt = 0;
    let lastDragSeenAt = 0;
    let sawShiftKey = false;
    let overlayShown = false;
    let internalDragActive = false;
    let idleResetTimer: number | undefined;
    let hintTimer: number | undefined;

    const isExternalFileDrag = (event: DragEvent) =>
      !internalDragActive && getLowercaseTypes(event.dataTransfer).some((type) => EXTERNAL_FILE_DRAG_TYPES.includes(type));

    const setOverlay = (shown: boolean) => {
      if (overlayShown === shown) return;
      overlayShown = shown;
      setIsFileDragActive(shown);
    };

    const showBlockedDragHint = () => {
      setBlockedDragHintVisible(true);
      window.clearTimeout(hintTimer);
      hintTimer = window.setTimeout(() => setBlockedDragHintVisible(false), BLOCKED_DRAG_HINT_MS);
    };

    const endDrag = (dropped: boolean) => {
      window.clearTimeout(idleResetTimer);
      // Entered without Shift and vanished almost at once: VS Code blocked the webview
      const vanishedQuickly = lastDragSeenAt - dragEnteredAt < BLOCKED_DRAG_WINDOW_MS;
      if (!dropped && enterDepth > 0 && !sawShiftKey && vanishedQuickly) {
        showBlockedDragHint();
      } else if (dropped) {
        // The user got it right: the reminder is no longer needed
        window.clearTimeout(hintTimer);
        setBlockedDragHintVisible(false);
      }
      enterDepth = 0;
      sawShiftKey = false;
      setOverlay(false);
    };

    /** Shared by dragenter/dragover; dragover can also (re)start tracking after an idle reset. */
    const trackDrag = (event: DragEvent, depthChange: number) => {
      if (enterDepth === 0) {
        dragEnteredAt = Date.now();
        sawShiftKey = false;
        enterDepth = 1;
        const types = getLowercaseTypes(event.dataTransfer);
        if (enabledRef.current && types.includes('files') && !types.some((type) => VSCODE_DRAG_TYPES.includes(type))) {
          onOsFileDragEnterRef.current?.();
        }
      } else {
        enterDepth += depthChange;
      }
      lastDragSeenAt = Date.now();
      if (event.shiftKey) sawShiftKey = true;
      setOverlay(enabledRef.current);
      window.clearTimeout(idleResetTimer);
      idleResetTimer = window.setTimeout(() => endDrag(false), DRAG_IDLE_RESET_MS);
    };

    const handleDragStart = () => { internalDragActive = true; };
    // dragend can be lost when the drag source element is removed mid-drag; any pointerdown
    // or drop also proves the internal drag is over
    const handleDragEnd = () => { internalDragActive = false; };

    const handleDragEnter = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      trackDrag(event, 1);
    };

    // preventDefault marks the panel as a valid drop target. Propagation is left alone:
    // VS Code's own listener reads shiftKey from these events to decide whether to block the iframe.
    const handleDragOver = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = enabledRef.current ? 'copy' : 'none';
      trackDrag(event, 0);
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!isExternalFileDrag(event) || enterDepth === 0) return;
      if (enterDepth === 1) {
        endDrag(false);
      } else {
        enterDepth -= 1;
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) {
        internalDragActive = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      endDrag(true);
      if (!enabledRef.current || !event.dataTransfer) return;
      onDropRef.current(extractDropPayload(event.dataTransfer));
    };

    window.addEventListener('dragstart', handleDragStart, true);
    window.addEventListener('dragend', handleDragEnd, true);
    window.addEventListener('pointerdown', handleDragEnd, true);
    window.addEventListener('dragenter', handleDragEnter, true);
    window.addEventListener('dragover', handleDragOver, true);
    window.addEventListener('dragleave', handleDragLeave, true);
    window.addEventListener('drop', handleDrop, true);
    return () => {
      window.clearTimeout(idleResetTimer);
      window.clearTimeout(hintTimer);
      window.removeEventListener('dragstart', handleDragStart, true);
      window.removeEventListener('dragend', handleDragEnd, true);
      window.removeEventListener('pointerdown', handleDragEnd, true);
      window.removeEventListener('dragenter', handleDragEnter, true);
      window.removeEventListener('dragover', handleDragOver, true);
      window.removeEventListener('dragleave', handleDragLeave, true);
      window.removeEventListener('drop', handleDrop, true);
    };
  }, []);

  const dismissBlockedDragHint = useCallback(() => setBlockedDragHintVisible(false), []);

  return { isFileDragActive, blockedDragHintVisible, dismissBlockedDragHint };
}
