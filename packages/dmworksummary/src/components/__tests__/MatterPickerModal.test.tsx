import React from 'react';
import { render as rtlRender, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MatterPickerModal from '../MatterPickerModal';

const mockListMatters = vi.fn();

vi.mock('../../api/matterBridge', () => ({
  listMatters: (...args: any[]) => mockListMatters(...args),
}));

vi.mock('@douyinfe/semi-ui', () => ({
  Modal: ({ children, visible, onOk, onCancel, title, okButtonProps }: any) => (
    visible ? (
      <div data-testid="modal" data-title={title}>
        <button onClick={onOk} disabled={okButtonProps?.disabled} data-testid="ok-btn">确定</button>
        <button onClick={onCancel} data-testid="cancel-btn">取消</button>
        {children}
      </div>
    ) : null
  ),
  Input: ({ value, onChange, placeholder }: any) => (
    <input
      data-testid="search-input"
      value={value}
      onChange={(e: any) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
  Spin: ({ size }: any) => <div data-testid="spinner" data-size={size}>loading</div>,
  Toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@douyinfe/semi-icons', () => ({
  IconSearch: () => <span data-testid="icon-search" />,
}));

function render(ui: React.ReactElement, options?: any) {
  return rtlRender(ui, { legacyRoot: true, ...options });
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('MatterPickerModal', () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  const mockMatters = [
    { id: '1', title: 'Matter One', status: 'open' as const, creator_id: 'u1', created_at: '', updated_at: '' },
    { id: '2', title: 'Matter Two', status: 'open' as const, creator_id: 'u2', created_at: '', updated_at: '' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockListMatters.mockResolvedValue({
      data: mockMatters,
      pagination: { has_more: false },
    });
  });

  async function openModal(overrideProps = {}) {
    const props = { visible: false, onSelect, onCancel, ...overrideProps };
    const result = render(<MatterPickerModal {...props} />);
    await act(async () => {
      result.rerender(<MatterPickerModal {...props} visible={true} />);
      await flushPromises();
    });
    return result;
  }

  it('loads matters when modal becomes visible', async () => {
    const props = { visible: false, onSelect, onCancel };
    const { rerender } = render(<MatterPickerModal {...props} />);
    expect(mockListMatters).not.toHaveBeenCalled();

    await act(async () => {
      rerender(<MatterPickerModal {...props} visible={true} />);
      await flushPromises();
    });

    expect(mockListMatters).toHaveBeenCalledWith({
      status: 'open',
      q: undefined,
      limit: 50,
      cursor: undefined,
    });
  });

  it('renders matters list after loading', async () => {
    await openModal();

    expect(screen.getByText('Matter One')).toBeInTheDocument();
    expect(screen.getByText('Matter Two')).toBeInTheDocument();
  });

  it('shows empty state when no matters available', async () => {
    mockListMatters.mockResolvedValue({
      data: [],
      pagination: { has_more: false },
    });

    await openModal();

    expect(screen.getByText('暂无可用事项')).toBeInTheDocument();
  });

  it('debounces search input', async () => {
    vi.useFakeTimers();

    const props = { visible: false, onSelect, onCancel };
    const { rerender } = render(<MatterPickerModal {...props} />);
    await act(async () => {
      rerender(<MatterPickerModal {...props} visible={true} />);
      await vi.runAllTimersAsync();
    });

    mockListMatters.mockClear();

    const input = screen.getByTestId('search-input');

    await act(async () => {
      fireEvent.change(input, { target: { value: 'test' } });
      fireEvent.change(input, { target: { value: 'test2' } });
      fireEvent.change(input, { target: { value: 'test3' } });
    });

    expect(mockListMatters).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await vi.runAllTimersAsync();
    });

    expect(mockListMatters).toHaveBeenCalledTimes(1);
    expect(mockListMatters).toHaveBeenCalledWith({
      status: 'open',
      q: 'test3',
      limit: 50,
      cursor: undefined,
    });

    vi.useRealTimers();
  });

  it('selects a matter and calls onSelect on confirm', async () => {
    await openModal();

    fireEvent.click(screen.getByText('Matter One'));
    fireEvent.click(screen.getByTestId('ok-btn'));

    expect(onSelect).toHaveBeenCalledWith('1', 'Matter One');
  });

  it('confirm button is disabled when nothing is selected', async () => {
    await openModal();

    const okBtn = screen.getByTestId('ok-btn');
    expect(okBtn).toBeDisabled();
  });

  it('calls onCancel when cancel is clicked', async () => {
    await openModal();

    fireEvent.click(screen.getByTestId('cancel-btn'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows load more when has_more is true', async () => {
    mockListMatters.mockResolvedValue({
      data: mockMatters,
      pagination: { has_more: true, next_cursor: 'cursor-abc' },
    });

    await openModal();

    expect(screen.getByText('加载更多...')).toBeInTheDocument();
  });

  it('loads more matters when load-more is clicked', async () => {
    mockListMatters
      .mockResolvedValueOnce({
        data: mockMatters,
        pagination: { has_more: true, next_cursor: 'cursor-abc' },
      })
      .mockResolvedValueOnce({
        data: [{ id: '3', title: 'Matter Three', status: 'open' as const, creator_id: 'u3', created_at: '', updated_at: '' }],
        pagination: { has_more: false },
      });

    await openModal();

    expect(screen.getByText('加载更多...')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('加载更多...'));
      await flushPromises();
    });

    expect(mockListMatters).toHaveBeenLastCalledWith({
      status: 'open',
      q: undefined,
      limit: 50,
      cursor: 'cursor-abc',
    });
  });

  it('does not render when not visible', () => {
    render(<MatterPickerModal visible={false} onSelect={onSelect} onCancel={onCancel} />);
    expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
  });
});
