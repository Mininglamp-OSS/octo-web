import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BotDetailModal from '../../../../../packages/dmworkbase/src/Components/BotDetailModal';

const mocks = vi.hoisted(() => ({
    apiGet: vi.fn(),
    apiPut: vi.fn(),
    apiPost: vi.fn(),
    fetchChannelInfo: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
}));

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

vi.mock('@douyinfe/semi-ui', async () => {
    const React = await import('react');
    return {
        Button: ({ children, onClick, disabled, loading, icon, ...props }: any) => (
            <button {...props} onClick={onClick} disabled={disabled || loading}>
                {icon}
                {children}
            </button>
        ),
        Input: ({ value, onChange, placeholder, maxLength }: any) => (
            <input
                value={value}
                placeholder={placeholder}
                maxLength={maxLength}
                onChange={(event) => onChange(event.target.value)}
            />
        ),
        TextArea: ({ value, onChange, placeholder }: any) => (
            <textarea
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
            />
        ),
        Image: ({ src }: any) => <img alt="" src={src} />,
        Spin: () => <div data-testid="spin" />,
        Toast: {
            success: mocks.toastSuccess,
            error: mocks.toastError,
        },
    };
});

vi.mock('@douyinfe/semi-icons', () => ({
    IconEdit: () => <span data-testid="icon-edit" />,
}));

vi.mock('wukongimjssdk', () => {
    class Channel {
        channelID: string;
        channelType: number;

        constructor(channelID: string, channelType: number) {
            this.channelID = channelID;
            this.channelType = channelType;
        }
    }

    return {
        Channel,
        ChannelTypePerson: 1,
        WKSDK: {
            shared: () => ({
                channelManager: {
                    fetchChannelInfo: mocks.fetchChannelInfo,
                },
            }),
        },
    };
});

vi.mock('../../../../../packages/dmworkbase/src/App', () => ({
    default: {
        apiClient: {
            get: mocks.apiGet,
            put: mocks.apiPut,
            post: mocks.apiPost,
        },
        loginInfo: {
            uid: 'viewer',
            token: '',
        },
        shared: {
            currentSpaceId: '',
            changeChannelAvatarTag: vi.fn(),
            avatarChannel: vi.fn(() => 'avatar.png'),
        },
        mittBus: {
            on: vi.fn(),
            off: vi.fn(),
        },
    },
}));

vi.mock('../../../../../packages/dmworkbase/src/Components/WKModal', async () => {
    const React = await import('react');
    return {
        default: ({ visible, children }: any) => (
            visible ? <div data-testid="wk-modal">{children}</div> : null
        ),
    };
});

vi.mock('../../../../../packages/dmworkbase/src/Components/WKAvatar', () => ({
    default: () => <div data-testid="wk-avatar" />,
}));

vi.mock('../../../../../packages/dmworkbase/src/Components/AiBadge', () => ({
    default: () => <span data-testid="ai-badge">AI</span>,
}));

vi.mock('../../../../../packages/dmworkbase/src/Components/ClawInfoModal/ClawInfoModal', () => ({
    default: () => null,
}));

vi.mock('../../../../../packages/dmworkbase/src/Service/AgentCardService', () => ({
    default: {
        getReportStatus: vi.fn(),
    },
}));

vi.mock('../../../../../packages/dmworkbase/src/i18n', async () => {
    const React = await import('react');
    const dict: Record<string, string> = {
        'botDetail.addFriend': 'Add friend',
        'botDetail.apply.defaultMessage': 'I want to use {{name}}',
        'botDetail.commands': 'Commands',
        'botDetail.creator': 'Creator',
        'botDetail.description': 'Description',
        'botDetail.edit': 'Edit',
        'botDetail.editDescription': 'Edit description',
        'botDetail.editRemark': 'Edit remark',
        'botDetail.nickname': 'Nickname',
        'botDetail.noDescription': 'No description yet',
        'botDetail.noRemark': 'Not set',
        'botDetail.remark': 'Remark',
        'botDetail.remarkPlaceholder': 'Enter a remark',
        'botDetail.remarkUpdated': 'Remark updated',
        'botDetail.remarkUpdateFailed': 'Failed to update remark',
        'botDetail.save': 'Save',
        'botDetail.sendMessage': 'Send message',
        'common.cancel': 'Cancel',
    };
    const translate = (key: string) => dict[key.replace(/^base\./, '')] || key;
    return {
        I18nContext: React.createContext({ t: translate }),
        t: translate,
    };
});

describe('BotDetailModal remark editing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiGet.mockResolvedValue({
            uid: 'bot-1',
            name: 'Original Bot',
            remark: 'Personal Bot',
            username: 'original_bot',
            bot_description: 'Helps with work',
            bot_creator_uid: 'owner',
            bot_creator_name: 'Owner',
            bot_commands: '',
            follow: 1,
        });
        mocks.apiPut.mockResolvedValue(undefined);
        mocks.fetchChannelInfo.mockResolvedValue(undefined);
    });

    it('shows the personal remark and saves updates through friend/remark', async () => {
        render(
            <BotDetailModal
                uid="bot-1"
                visible
                onClose={vi.fn()}
                onChat={vi.fn()}
            />
        );

        expect(await screen.findAllByText('Personal Bot')).toHaveLength(2);
        expect(screen.getByText('Remark')).toBeInTheDocument();
        expect(screen.getByText('Nickname')).toBeInTheDocument();
        expect(screen.getByText('Original Bot')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Edit remark'));
        fireEvent.change(screen.getByPlaceholderText('Enter a remark'), {
            target: { value: '  New Alias  ' },
        });
        fireEvent.click(screen.getByText('Save'));

        await waitFor(() => {
            expect(mocks.apiPut).toHaveBeenCalledWith('friend/remark', {
                uid: 'bot-1',
                remark: 'New Alias',
            });
        });

        await waitFor(() => {
            expect(screen.getAllByText('New Alias')).toHaveLength(2);
        });
        expect(mocks.fetchChannelInfo).toHaveBeenCalledWith(
            expect.objectContaining({ channelID: 'bot-1', channelType: 1 })
        );
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Remark updated');
    });

    it('does not apply a stale remark save after switching to another bot', async () => {
        const saveRemark = deferred();
        mocks.apiPut.mockReturnValueOnce(saveRemark.promise);
        mocks.apiGet.mockImplementation((path: string) => Promise.resolve(
            path === 'users/bot-2'
                ? {
                    uid: 'bot-2',
                    name: 'Bot Two',
                    remark: '',
                    username: 'bot_two',
                    bot_description: '',
                    bot_creator_uid: 'owner',
                    bot_creator_name: 'Owner',
                    bot_commands: '',
                    follow: 1,
                }
                : {
                    uid: 'bot-1',
                    name: 'Original Bot',
                    remark: 'Personal Bot',
                    username: 'original_bot',
                    bot_description: 'Helps with work',
                    bot_creator_uid: 'owner',
                    bot_creator_name: 'Owner',
                    bot_commands: '',
                    follow: 1,
                }
        ));

        const { rerender } = render(
            <BotDetailModal
                uid="bot-1"
                visible
                onClose={vi.fn()}
                onChat={vi.fn()}
            />
        );

        expect(await screen.findAllByText('Personal Bot')).toHaveLength(2);

        fireEvent.click(screen.getByLabelText('Edit remark'));
        fireEvent.change(screen.getByPlaceholderText('Enter a remark'), {
            target: { value: 'Old Alias' },
        });
        fireEvent.click(screen.getByText('Save'));

        rerender(
            <BotDetailModal
                uid="bot-2"
                visible
                onClose={vi.fn()}
                onChat={vi.fn()}
            />
        );

        expect(await screen.findByText('Bot Two')).toBeInTheDocument();

        await act(async () => {
            saveRemark.resolve();
            await saveRemark.promise;
        });

        expect(screen.queryByText('Old Alias')).not.toBeInTheDocument();
        expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Remark updated');
        expect(mocks.fetchChannelInfo).not.toHaveBeenCalled();
    });
});
