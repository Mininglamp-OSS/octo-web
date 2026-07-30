/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import ReactDOM from 'react-dom';
import { act } from 'react-dom/test-utils';

// Lightweight test harness built directly on react-dom@17.
//
// @testing-library/react in this monorepo resolves to a build that pulls
// react-dom@19, which clashes with the app's react@17 ("Invalid hook call").
// A tiny in-house harness keeps every render on react@17, so hooks and
// components under test share one React copy.

export { act };

export interface RenderHookResult<T, P> {
  result: { current: T };
  rerender: (props?: P) => void;
  unmount: () => void;
}

export function renderHook<T, P = void>(
  hook: (props: P) => T,
  initialProps?: P,
): RenderHookResult<T, P> {
  const result = { current: undefined as unknown as T };
  let props = initialProps as P;
  const Comp = () => {
    result.current = hook(props);
    return null;
  };
  const container = document.createElement('div');
  act(() => {
    ReactDOM.render(React.createElement(Comp), container);
  });
  return {
    result,
    rerender: (next?: P) => {
      if (next !== undefined) props = next;
      act(() => {
        ReactDOM.render(React.createElement(Comp), container);
      });
    },
    unmount: () => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
    },
  };
}

export interface RenderResult {
  container: HTMLElement;
  unmount: () => void;
  getByText: (text: string) => HTMLElement;
  queryByText: (text: string) => HTMLElement | null;
  getByRole: (role: 'button', opts: { name: string }) => HTMLElement;
  queryByRole: (role: 'button', opts: { name: string }) => HTMLElement | null;
  click: (el: Element) => void;
}

function leafWithText(container: HTMLElement, text: string): HTMLElement | null {
  const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
  return (
    all.find((el) => el.children.length === 0 && (el.textContent ?? '').trim() === text) ?? null
  );
}

function buttonByName(container: HTMLElement, name: string): HTMLElement | null {
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'));
  return (
    buttons.find(
      (b) => (b.textContent ?? '').trim() === name || b.getAttribute('aria-label') === name,
    ) ?? null
  );
}

export function render(el: React.ReactElement): RenderResult {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    ReactDOM.render(el, container);
  });
  const click = (target: Element) => {
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };
  return {
    container,
    unmount: () => {
      act(() => {
        ReactDOM.unmountComponentAtNode(container);
      });
      container.remove();
    },
    getByText: (text) => {
      const found = leafWithText(container, text);
      if (!found) throw new Error(`getByText: no element with text "${text}"`);
      return found;
    },
    queryByText: (text) => leafWithText(container, text),
    getByRole: (_role, { name }) => {
      const found = buttonByName(container, name);
      if (!found) throw new Error(`getByRole: no button named "${name}"`);
      return found;
    },
    queryByRole: (_role, { name }) => buttonByName(container, name),
    click,
  };
}

export async function waitFor(
  cb: () => void,
  { timeout = 1000, interval = 10 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      cb();
      return;
    } catch (err) {
      if (Date.now() - start > timeout) throw err;
      // eslint-disable-next-line no-await-in-loop
      await act(async () => {
        await new Promise((r) => setTimeout(r, interval));
      });
    }
  }
}
