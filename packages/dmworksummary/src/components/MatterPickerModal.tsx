import React, { Component } from 'react';
import { Modal, Input, Spin, Toast } from '@douyinfe/semi-ui';
import { IconSearch } from '@douyinfe/semi-icons';
import * as matterBridge from '../api/matterBridge';
import type { MatterBrief } from '../api/matterBridge';
import './MatterPickerModal.css';

interface MatterPickerModalProps {
  visible: boolean;
  onSelect: (matterId: string, matterTitle: string) => void;
  onCancel: () => void;
}

interface MatterPickerModalState {
  matters: MatterBrief[];
  loading: boolean;
  keyword: string;
  hasMore: boolean;
  selectedId: string | null;
}

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

export default class MatterPickerModal extends Component<MatterPickerModalProps, MatterPickerModalState> {
  state: MatterPickerModalState = {
    matters: [],
    loading: false,
    keyword: '',
    hasMore: false,
    selectedId: null,
  };

  private cursor: string | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidUpdate(prevProps: MatterPickerModalProps) {
    if (this.props.visible && !prevProps.visible) {
      this.reset();
      this.load('', false);
    }
  }

  componentWillUnmount() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  private reset() {
    this.cursor = undefined;
    this.setState({ matters: [], keyword: '', hasMore: false, selectedId: null });
  }

  private async load(searchKey: string, append: boolean) {
    this.setState({ loading: true });
    try {
      const resp = await matterBridge.listMatters({
        status: 'open',
        q: searchKey || undefined,
        limit: PAGE_SIZE,
        cursor: append ? this.cursor : undefined,
      });
      this.cursor = resp.pagination.next_cursor;
      this.setState((prev) => ({
        matters: append ? [...prev.matters, ...resp.data] : resp.data,
        hasMore: resp.pagination.has_more,
        loading: false,
      }));
    } catch (err: any) {
      Toast.error(err.message || '加载事项失败');
      this.setState({ loading: false });
    }
  }

  handleKeywordChange = (val: string) => {
    this.setState({ keyword: val, selectedId: null });
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.cursor = undefined;
      this.load(val, false);
    }, DEBOUNCE_MS);
  };

  handleConfirm = () => {
    const { selectedId, matters } = this.state;
    if (!selectedId) return;
    const matter = matters.find(m => m.id === selectedId);
    if (matter) {
      this.props.onSelect(matter.id, matter.title);
    }
  };

  handleLoadMore = () => {
    const { hasMore, loading, keyword } = this.state;
    if (hasMore && !loading) {
      this.load(keyword, true);
    }
  };

  render() {
    const { visible, onCancel } = this.props;
    const { matters, loading, keyword, hasMore, selectedId } = this.state;

    return (
      <Modal
        title="选择目标事项"
        visible={visible}
        onOk={this.handleConfirm}
        onCancel={onCancel}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ disabled: !selectedId }}
        width={480}
        className="matter-picker-modal"
      >
        <Input
          prefix={<IconSearch />}
          placeholder="搜索事项..."
          value={keyword}
          onChange={this.handleKeywordChange}
          showClear
          style={{ marginBottom: 12 }}
        />

        <div className="matter-picker-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
          {loading && matters.length === 0 ? (
            <div className="matter-picker-loading">
              <Spin />
            </div>
          ) : matters.length === 0 ? (
            <div className="matter-picker-empty">暂无可用事项</div>
          ) : (
            <>
              {matters.map((matter) => (
                <div
                  key={matter.id}
                  className={`matter-picker-item ${selectedId === matter.id ? 'selected' : ''}`}
                  onClick={() => this.setState({ selectedId: matter.id })}
                >
                  <span className="matter-picker-item-title">{matter.title}</span>
                  <span className={`matter-picker-item-status status-${matter.status}`}>
                    {matter.status}
                  </span>
                </div>
              ))}
              {hasMore && (
                <div className="matter-picker-load-more" onClick={this.handleLoadMore}>
                  {loading ? <Spin size="small" /> : '加载更多...'}
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
    );
  }
}
