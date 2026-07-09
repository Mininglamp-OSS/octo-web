using System.Collections.ObjectModel;
using System.Windows.Input;
using OctoMaui.Models;
using OctoMaui.Services;

namespace OctoMaui.ViewModels;

/// <summary>
/// Drives the main chat surface: channel list on the left, message stream on
/// the right, plus a send box. Subscribes to live WebSocket pushes.
/// </summary>
public sealed class ChatViewModel : ViewModelBase
{
    private readonly IAuthService _auth;
    private readonly IApiService _api;
    private readonly IWebSocketService _ws;
    private readonly IThemeService _theme;

    public ChatViewModel(IAuthService auth, IApiService api, IWebSocketService ws, IThemeService theme)
    {
        _auth = auth;
        _api = api;
        _ws = ws;
        _theme = theme;

        SendCommand = CreateCommand(async () => await SendAsync(), () => !string.IsNullOrWhiteSpace(Draft) && SelectedChannel is not null);
        LogoutCommand = CreateCommand(async () => await LogoutAsync());
        ToggleThemeCommand = CreateCommand(async () => await ToggleThemeAsync());

        _ws.MessageReceived += OnMessageReceived;
        _ws.ConnectionClosed += OnConnectionClosed;
        _theme.ThemeChanged += (_, _) => MainThread.BeginInvokeOnMainThread(RefreshThemeLabel);
        Messages.CollectionChanged += (_, _) => IsEmpty = Messages.Count == 0;
        RefreshThemeLabel();
    }

    // --- bound properties ---

    public ObservableCollection<Channel> Channels { get; } = new();
    public ObservableCollection<Message> Messages { get; } = new();

    /// <summary>True when the current channel has no messages (drives the empty-state overlay).</summary>
    public bool IsEmpty { get => Get<bool>(); private set => Set(value); }

    public Channel? SelectedChannel
    {
        get => Get<Channel?>();
        set
        {
            if (Set(value))
            {
                _ = LoadMessagesAsync();
            }
        }
    }

    public string Draft { get => Get<string>(); set { Set(value); ((Command)SendCommand).ChangeCanExecute(); } }
    public bool IsLoading { get => Get<bool>(); set => Set(value); }
    public string StatusText { get => Get<string>(); set => Set(value); } = string.Empty;

    /// <summary>Localized label for the theme toggle button.</summary>
    public string ThemeLabel { get => Get<string>(); set => Set(value); } = "主题";

    public ICommand SendCommand { get; }
    public ICommand LogoutCommand { get; }
    public ICommand ToggleThemeCommand { get; }

    // --- lifecycle ---

    public async Task InitializeAsync()
    {
        await _auth.HydrateCurrentUserAsync();
        await LoadChannelsAsync();
        await _ws.ConnectAsync(_auth.Token!);
        StatusText = "已连接";
    }

    // --- data loading ---

    private async Task LoadChannelsAsync()
    {
        IsLoading = true;
        try
        {
            var channels = await _api.GetChannelsAsync(_auth.Token!);
            Channels.Clear();
            foreach (var c in channels) Channels.Add(c);
            SelectedChannel = Channels.FirstOrDefault();
        }
        catch (Exception ex)
        {
            StatusText = $"加载频道失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task LoadMessagesAsync()
    {
        if (SelectedChannel is null) return;
        IsLoading = true;
        try
        {
            var msgs = await _api.GetMessagesAsync(_auth.Token!, SelectedChannel.Id, limit: 50);
            Messages.Clear();
            foreach (var m in msgs) Messages.Add(m);
        }
        catch (Exception ex)
        {
            StatusText = $"加载消息失败: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    // --- sending & receiving ---

    private async Task SendAsync()
    {
        if (SelectedChannel is null || string.IsNullOrWhiteSpace(Draft)) return;
        var content = Draft;
        Draft = string.Empty;
        try
        {
            await _ws.SendAsync(SelectedChannel.Id, content);
            // Optimistic local echo.
            Messages.Add(new Message
            {
                ChannelId = SelectedChannel.Id,
                FromUid = _auth.CurrentUser?.Id ?? "me",
                SenderName = _auth.CurrentUser?.DisplayName ?? "我",
                Content = content,
                TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }
        catch (Exception ex)
        {
            StatusText = $"发送失败: {ex.Message}";
        }
    }

    private void OnMessageReceived(Message msg)
    {
        if (msg.ChannelId != SelectedChannel?.Id) return;
        Messages.Add(msg);
    }

    private void OnConnectionClosed(Exception ex)
        => StatusText = $"连接断开: {ex.Message}";

    private async Task LogoutAsync()
    {
        await _ws.DisconnectAsync();
        await _auth.LogoutAsync();
    }

    // --- theme ---

    /// <summary>Cycle System → Light → Dark → System.</summary>
    private async Task ToggleThemeAsync()
    {
        var next = _theme.Mode switch
        {
            AppTheme.Unspecified => AppTheme.Light,
            AppTheme.Light => AppTheme.Dark,
            _ => AppTheme.Unspecified,
        };
        await _theme.SetModeAsync(next);
        RefreshThemeLabel();
    }

    private void RefreshThemeLabel()
    {
        ThemeLabel = _theme.Mode switch
        {
            AppTheme.Light => "浅色",
            AppTheme.Dark => "深色",
            _ => "跟随系统",
        };
    }
}
