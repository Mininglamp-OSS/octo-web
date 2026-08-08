import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '../../__tests__/harness';
import { useDropzone } from '../useDropzone';

/** Build a React.DragEvent-shaped object with the pieces the hook uses. */
function dragEvent(types: string[] = ['Files'], files: File[] = []): React.DragEvent<HTMLElement> {
  const fileList = files as unknown as FileList;
  const dt = {
    types,
    files: fileList,
    dropEffect: 'none',
  } as unknown as DataTransfer;
  return {
    dataTransfer: dt,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent<HTMLElement>;
}

function fakeFile(name: string): File {
  return { name, size: 1, type: 'text/plain' } as unknown as File;
}

describe('useDropzone', () => {
  it('starts idle (isDraggingOver === false)', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    expect(result.current.isDraggingOver).toBe(false);
  });

  it('turns on isDraggingOver on the first file dragenter', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    act(() => result.current.bind.onDragEnter(dragEvent(['Files'])));
    expect(result.current.isDraggingOver).toBe(true);
  });

  it('ignores non-file drags (in-page HTML5 text drag)', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    act(() => result.current.bind.onDragEnter(dragEvent(['text/plain'])));
    expect(result.current.isDraggingOver).toBe(false);
  });

  it('nested enter/leave events do not flicker the overlay', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    // Simulate: user drags into container (enter), then over a child
    // (enter++), then out of that child (leave), then out of container
    // (leave). The overlay should stay on until the outer leave.
    act(() => result.current.bind.onDragEnter(dragEvent()));
    expect(result.current.isDraggingOver).toBe(true);
    act(() => result.current.bind.onDragEnter(dragEvent()));
    expect(result.current.isDraggingOver).toBe(true);
    act(() => result.current.bind.onDragLeave(dragEvent()));
    expect(result.current.isDraggingOver).toBe(true);
    act(() => result.current.bind.onDragLeave(dragEvent()));
    expect(result.current.isDraggingOver).toBe(false);
  });

  it('drop fires onDrop with the FileList and turns overlay off', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropzone({ onDrop }));
    act(() => result.current.bind.onDragEnter(dragEvent()));
    const files = [fakeFile('a.pdf'), fakeFile('b.png')];
    const ev = dragEvent(['Files'], files);
    act(() => result.current.bind.onDrop(ev));
    expect(onDrop).toHaveBeenCalledTimes(1);
    // Called with the underlying FileList (our mock passes the array through).
    expect(onDrop).toHaveBeenCalledWith(files);
    expect(result.current.isDraggingOver).toBe(false);
  });

  it('drop with no files does not fire onDrop', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropzone({ onDrop }));
    act(() => result.current.bind.onDragEnter(dragEvent()));
    act(() => result.current.bind.onDrop(dragEvent(['Files'], [])));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('disabled: drag enter/over/drop are ignored, onDrop never fires', () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDropzone({ onDrop, disabled: true }));
    act(() => result.current.bind.onDragEnter(dragEvent()));
    expect(result.current.isDraggingOver).toBe(false);
    act(() => result.current.bind.onDrop(dragEvent(['Files'], [fakeFile('a')])));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('dragover on file drag prevents default (browser-nav guard)', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    const ev = dragEvent();
    act(() => result.current.bind.onDragOver(ev));
    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('dragover on non-file drag does not preventDefault (lets in-page drag proceed)', () => {
    const { result } = renderHook(() => useDropzone({ onDrop: () => {} }));
    const ev = dragEvent(['text/plain']);
    act(() => result.current.bind.onDragOver(ev));
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it('installs window-level dragover/drop preventers on mount and removes them on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useDropzone({ onDrop: () => {} }));
    // Two window listeners: dragover + drop
    const registered = addSpy.mock.calls.filter(
      (c) => c[0] === 'dragover' || c[0] === 'drop',
    );
    expect(registered.length).toBeGreaterThanOrEqual(2);
    unmount();
    const removed = removeSpy.mock.calls.filter(
      (c) => c[0] === 'dragover' || c[0] === 'drop',
    );
    expect(removed.length).toBeGreaterThanOrEqual(2);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
