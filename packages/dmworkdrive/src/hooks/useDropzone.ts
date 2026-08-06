import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseDropzoneOptions {
  /** Called with the dropped FileList once the user releases the drag. */
  onDrop: (files: FileList) => void;
  /** When true, dragenter / dragover / drop are ignored — used to disable
   *  the drop target for preview_only / no-space states. */
  disabled?: boolean;
}

export interface UseDropzoneResult {
  /** True while the user is dragging files over the window and the target
   *  is enabled. Bind this to a visual overlay. */
  isDraggingOver: boolean;
  /**
   * Handlers for the element that owns the drop zone. Attach the whole
   * object as spread props (`<div {...bind}>`). The window-level default
   * suppression that prevents the browser from navigating to the dropped
   * file lives inside the hook and is attached to `window` for the hook's
   * lifetime.
   */
  bind: {
    onDragEnter: (e: React.DragEvent<HTMLElement>) => void;
    onDragOver: (e: React.DragEvent<HTMLElement>) => void;
    onDragLeave: (e: React.DragEvent<HTMLElement>) => void;
    onDrop: (e: React.DragEvent<HTMLElement>) => void;
  };
}

/**
 * True when the drag payload contains OS files (not just an in-page HTML5
 * drag). Guarded because dragging text, images from another page, etc.
 * shouldn't light up the overlay.
 */
function hasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  // 'Files' is the canonical marker Chrome/Firefox/Safari/Edge emit for
  // OS-level file drags. types is a DOMStringList / plain array depending
  // on browser, so iterate defensively.
  const types = dt.types;
  if (!types) return false;
  for (let i = 0; i < (types.length ?? 0); i += 1) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

/**
 * File-drop handling for the drive list. Two moving parts:
 *
 *  1. Attaches window-level default preventers for dragover / drop so
 *     dragging a file INTO the app but missing the actual drop zone
 *     doesn't cause the browser to navigate away from the drive page
 *     (default browser behaviour opens dropped files). This is registered
 *     on mount and cleaned up on unmount.
 *
 *  2. Returns handlers to spread onto the visible drop target. Enter/leave
 *     are counted rather than boolean-flagged: nested elements fire
 *     dragleave when the pointer crosses into a child even though the
 *     drop zone is still active, so a naive setState(false) on leave
 *     flickers the overlay. The counter goes to zero only when the
 *     pointer actually exits the outer element.
 */
export function useDropzone({ onDrop, disabled }: UseDropzoneOptions): UseDropzoneResult {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const enterCountRef = useRef(0);
  const onDropRef = useRef(onDrop);
  const disabledRef = useRef(disabled);
  onDropRef.current = onDrop;
  disabledRef.current = disabled;

  // Window guard: swallow drag defaults everywhere so a missed drop can't
  // navigate the browser. Without this, dropping outside the target still
  // opens the file in a new tab / replaces the SPA.
  useEffect(() => {
    const preventNav = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener('dragover', preventNav);
    window.addEventListener('drop', preventNav);
    return () => {
      window.removeEventListener('dragover', preventNav);
      window.removeEventListener('drop', preventNav);
    };
  }, []);

  const reset = useCallback(() => {
    enterCountRef.current = 0;
    setIsDraggingOver(false);
  }, []);

  const handleEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (disabledRef.current) return;
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    enterCountRef.current += 1;
    if (enterCountRef.current === 1) setIsDraggingOver(true);
  }, []);

  const handleOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (disabledRef.current) return;
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    // Explicit copy cursor — feels right for "add files here" and matches
    // upload-button semantics rather than a link/move affordance.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleLeave = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (disabledRef.current) return;
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    enterCountRef.current = Math.max(0, enterCountRef.current - 1);
    if (enterCountRef.current === 0) setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLElement>) => {
    if (disabledRef.current) {
      // Still prevent navigation even when disabled — dropping while
      // disabled shouldn't open the file in the browser.
      if (hasFiles(e.dataTransfer)) e.preventDefault();
      reset();
      return;
    }
    if (!hasFiles(e.dataTransfer)) {
      reset();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    reset();
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) onDropRef.current(files);
  }, [reset]);

  return {
    isDraggingOver,
    bind: {
      onDragEnter: handleEnter,
      onDragOver: handleOver,
      onDragLeave: handleLeave,
      onDrop: handleDrop,
    },
  };
}
