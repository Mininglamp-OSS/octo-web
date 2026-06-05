import React, { Component } from 'react';
import axios from 'axios';
import { Toast } from '@douyinfe/semi-ui';
import { WKApp, I18nContext } from '@octo/base';
import { Sparkle } from 'lucide-react';
import * as summaryApi from '../api/summaryApi';

interface ChatSummaryStarButtonProps {
    channel: { channelID: string; channelType: number };
}

interface ChatSummaryStarButtonState {
    hasSummaries: boolean;
    loaded: boolean;
}

export default class ChatSummaryStarButton extends Component<
    ChatSummaryStarButtonProps,
    ChatSummaryStarButtonState
> {
    static contextType = I18nContext;
    declare context: React.ContextType<typeof I18nContext>;

    private abortController: AbortController | null = null;

    constructor(props: ChatSummaryStarButtonProps) {
        super(props);
        this.state = { hasSummaries: false, loaded: false };
    }

    componentDidUpdate(prevProps: ChatSummaryStarButtonProps) {
        if (prevProps.channel.channelID !== this.props.channel.channelID) {
            this.abortController?.abort();
            this.setState({ hasSummaries: false, loaded: false });
        }
    }

    componentDidMount() {
        window.addEventListener('chat-summary-created', this.handleSummaryCreated as EventListener);
        window.addEventListener('chat-summary-deleted', this.handleSummaryDeleted as EventListener);
    }

    componentWillUnmount() {
        this.abortController?.abort();
        window.removeEventListener('chat-summary-created', this.handleSummaryCreated as EventListener);
        window.removeEventListener('chat-summary-deleted', this.handleSummaryDeleted as EventListener);
    }

    private handleSummaryCreated = (e: CustomEvent<{ channelId: string }>) => {
        if (e.detail?.channelId === this.props.channel.channelID) {
            this.setState({ hasSummaries: true, loaded: true });
        }
    };

    private handleSummaryDeleted = (e: CustomEvent<{ channelId: string }>) => {
        if (e.detail?.channelId === this.props.channel.channelID) {
            void this.fetchSummaryCount();
        }
    };

    // Three outcomes are distinguished so the caller never confuses a load
    // failure with "no summaries":
    //   { state: 'ok', hasSummaries } — genuine result (total resolved)
    //   { state: 'cancelled' }        — superseded/aborted request, ignore
    //   { state: 'failed' }           — network/server error, surface to user
    private async fetchSummaryCount(): Promise<
        { state: 'ok'; hasSummaries: boolean } | { state: 'cancelled' } | { state: 'failed' }
    > {
        this.abortController?.abort();
        const controller = new AbortController();
        this.abortController = controller;

        try {
            const res = await summaryApi.listSummaries(
                { origin_channel_id: this.props.channel.channelID, page: 1, page_size: 1 },
                { signal: controller.signal },
            );
            if (controller.signal.aborted) {
                return { state: 'cancelled' };
            }
            const hasSummaries = res.total > 0;
            this.setState({ hasSummaries, loaded: true });
            return { state: 'ok', hasSummaries };
        } catch (err: unknown) {
            // Cancellation identity is preserved by the api layer (see summaryApi get helper).
            if (axios.isCancel(err) || controller.signal.aborted) {
                return { state: 'cancelled' };
            }
            // Genuine load failure: cannot assert "no summaries".
            return { state: 'failed' };
        }
    }

    private handleClick = async () => {
        if (this.state.loaded) {
            this.emitForHasSummaries(this.state.hasSummaries);
            return;
        }

        const result = await this.fetchSummaryCount();

        // Cancelled (superseded by a newer request): do nothing.
        if (result.state === 'cancelled') {
            return;
        }
        // Load failed: surface an error and do NOT route the user into the
        // create flow, which would risk creating a duplicate summary.
        if (result.state === 'failed') {
            Toast.error(this.context.t('summary.common.loadingFailed'));
            return;
        }

        this.emitForHasSummaries(result.hasSummaries);
    };

    private emitForHasSummaries(hasSummaries: boolean) {
        const { channel } = this.props;
        if (hasSummaries) {
            WKApp.mittBus.emit('wk:toggle-summary-panel', {
                channelId: channel.channelID,
                channelType: channel.channelType,
                summaryPanelView: 'history',
            });
        } else {
            WKApp.mittBus.emit('wk:open-summary-modal', {
                channelId: channel.channelID,
                channelType: channel.channelType,
            });
        }
    }

    render() {
        const { t } = this.context;
        return (
            <div
                onClick={(e) => {
                    e.stopPropagation();
                    void this.handleClick();
                }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title={t('summary.chatSummary.starTooltip')}
            >
                <Sparkle
                    size={20}
                    fill="none"
                    color="currentColor"
                />
            </div>
        );
    }
}
