import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';

vi.mock('../../../../../packages/dmworkbase/src/App', () => ({
  default: {
    config: {
      themeMode: 'light',
    },
  },
  ThemeMode: {
    light: 'light',
    dark: 'dark',
  },
}));

const mocks = vi.hoisted(() => ({
  t: vi.fn((key: string) => key),
}));

vi.mock('../../../../../packages/dmworkbase/src/i18n/I18nProvider', () => ({
  I18nContext: React.createContext({
    format: () => '',
    locale: 'zh-CN',
    setLocale: () => {},
    t: mocks.t,
  }),
}));

import WKViewQueueHeader from '../../../../../packages/dmworkbase/src/Components/WKViewQueueHeader';

function getBack(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.wk-viewqueueheader-back');
}

describe('WKViewQueueHeader desktop back hit-test regression', () => {
  beforeEach(() => {
    mocks.t.mockClear();
  });

  it('renders back as a descendant of the desktop layout element', () => {
    const { container } = render(
      <WKViewQueueHeader title="Conversation" onBack={() => {}} />,
    );
    const layout = container.querySelector('[data-desktop-chrome="layout"]');
    const back = getBack(container);
    expect(layout).not.toBeNull();
    expect(back).not.toBeNull();
    // jsdom only pins the structure; native Electron clicks are verified separately.
    expect(layout!.contains(back!)).toBe(true);
  });

  it('fires onBack when the back control is clicked', () => {
    const onBack = vi.fn();
    const { container } = render(
      <WKViewQueueHeader title="Conversation" onBack={onBack} />,
    );
    fireEvent.click(getBack(container)!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders title and no back when hideBack is set', () => {
    const onBack = vi.fn();
    const { container, getByText } = render(
      <WKViewQueueHeader title="Hidden" hideBack onBack={onBack} />,
    );
    expect(getByText('Hidden')).toBeTruthy();
    expect(getBack(container)).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('keeps callback invocation safe when onBack is omitted', () => {
    const { container } = render(<WKViewQueueHeader title="No back" />);
    expect(() => fireEvent.click(getBack(container)!)).not.toThrow();
  });

  it('keeps finish and custom action behavior unchanged', () => {
    const onFinished = vi.fn();
    const onFinishButtonContext = vi.fn();
    const customAction = <span className="custom-action">Extra</span>;
    const { container, getByText } = render(
      <WKViewQueueHeader
        title="Done view"
        showFinishButton
        onFinished={onFinished}
        onFinishButtonContext={onFinishButtonContext}
        action={customAction}
      />,
    );
    expect(onFinishButtonContext).toHaveBeenCalledTimes(1);
    fireEvent.click(getByText('base.common.done'));
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.custom-action')?.textContent).toBe('Extra');
  });
});
