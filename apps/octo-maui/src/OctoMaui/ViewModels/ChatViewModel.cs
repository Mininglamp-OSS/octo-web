using System.Collections.ObjectModel;
using System.Windows.Input;
using OctoMaui.Models;
using OctoMaui.Services;

namespace OctoMaui.ViewModels;

/// <summary>
/// Drives the main chat surface: channel list on the left, message stream on
/// the right, plus a send box. Subscribes to live WebSocket pushes including
/// streaming AI agent replies and supports file/image attachments.
/// </summary>
public sealed class ChatViewModel : ViewModelBase
{
    private readonly IAuthService _auth;
    private readonly IApiService _api;
    private readonly IWebSocketService _ws;
    private readonly IThemeService _theme;

    /// <summary>Tracks the streaming message being built (messageId -> Message).</summary>
    private readonly Dictionary<string, Message> _streamingMessages = new();

    public ChatViewModel(IAuthService auth, IApiService api, IWebSocketService ws, IThemeService theme)
    {
        _auth = auth;
        _api = api;
        _ws = ws;
        _theme = theme;

        SendCommand = CreateCommand(async () => await SendAsync(), () => !string.IsNullOrWhiteSpace(Draft) && SelectedChannel is not null);
        LogoutCommand = CreateCommand(async () => await LogoutAsync());
        ToggleThemeCommand = CreateCommand(async () => await ToggleThemeAsync());
        SwitchServerCommand = CreateCommand(async () => await SwitchServerAsync());
        AttachFileCommand = CreateCommand(async () => await AttachFileAsync(), () => SelectedChannel is not null);
        AttachImageCommand = CreateCommand(async () => await AttachImageAsync(), () => SelectedChannel is not null);

        _ws.MessageReceived += OnMessageReceived;
        _ws.StreamStarted += OnStreamStarted;
        _ws.StreamChunkReceived += OnStreamChunkReceived;
        _ws.StreamEnded += OnStreamEnded;
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

    /// <summary>True when an AI agent is actively streaming a reply (typing indicator).</summary>
    public bool IsAgentTyping
    {
        get => Get<bool>();
        set => Set(value);
    }

    /// <summary>Localized label for the theme toggle button.</summary>
    public string ThemeLabel { get => Get<string>(); set => Set(value); } = "主题";

    public ICommand SendCommand { get; }
    public ICommand LogoutCommand { get; }
    public ICommand ToggleThemeCommand { get; }
    public ICommand SwitchServerCommand { get; }
    public ICommand AttachFileCommand { get; }
    public ICommand AttachImageCommand { get; }

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
        // If this is the final version of a streamed message, remove the
        // streaming placeholder before adding the complete one.
        if (_streamingMessages.TryGetValue(msg.Id, out var placeholder))
        {
            Messages.Remove(placeholder);
            _streamingMessages.Remove(msg.Id);
        }
        Messages.Add(msg);
    }

    // --- streaming reply handling ---

    private void OnStreamStarted(string messageId)
    {
        IsAgentTyping = true;
        // Create a placeholder streaming message.
        var msg = new Message
        {
            Id = messageId,
            ChannelId = SelectedChannel?.Id ?? "",
            FromUid = "agent",
            SenderName = "🦞 Lobster",
            Content = "",
            IsStreaming = true,
            TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
        _streamingMessages[messageId] = msg;
        Messages.Add(msg);
    }

    private void OnStreamChunkReceived(string messageId, string chunk)
    {
        if (_streamingMessages.TryGetValue(messageId, out var msg))
        {
            // Append chunk to the message content.
            msg.Content += chunk;
            // Force the CollectionView to refresh this item by replacing it.
            var idx = Messages.IndexOf(msg);
            if (idx >= 0)
            {
                Messages[idx] = msg;
            }
        }
    }

    private void OnStreamEnded(string messageId)
    {
        IsAgentTyping = false;
        if (_streamingMessages.TryGetValue(messageId, out var msg))
        {
            msg.IsStreaming = false;
            _streamingMessages.Remove(messageId);
            // Final refresh.
            var idx = Messages.IndexOf(msg);
            if (idx >= 0)
            {
                Messages[idx] = msg;
            }
        }
    }

    // --- file / image upload ---

    private async Task AttachFileAsync()
    {
        if (SelectedChannel is null) return;
        try
        {
            var result = await FilePicker.PickAsync(new PickOptions
            {
                PickerTitle = "选择文件",
                FileTypes = new FilePickerFileType(new Dictionary<DevicePlatform, IEnumerable<string>>
                {
                    { DevicePlatform.WinUI, new[] { "*" } },
                    { DevicePlatform.macOS, new[] { "*" } },
                    { DevicePlatform.Android, new[] { "*" } },
                    { DevicePlatform.iOS, new[] { "*" } },
                }),
            });
            if (result is null) return;

            using var stream = await result.OpenReadAsync();
            var contentType = result.ContentType ?? "application/octet-stream";
            StatusText = "正在上传文件…";
            await _api.UploadFileAsync(_auth.Token!, SelectedChannel.Id, stream, result.FileName, contentType);
            StatusText = "已上传";
        }
        catch (Exception ex)
        {
            StatusText = $"上传失败: {ex.Message}";
        }
    }

    private async Task AttachImageAsync()
    {
        if (SelectedChannel is null) return;
        try
        {
            var result = await FilePicker.PickAsync(new PickOptions
            {
                PickerTitle = "选择图片",
                FileTypes = FilePickerFileType.Images,
            });
            if (result is null) return;

            using var stream = await result.OpenReadAsync();
            var contentType = result.ContentType ?? "image/png";
            StatusText = "正在上传图片…";
            await _api.UploadFileAsync(_auth.Token!, SelectedChannel.Id, stream, result.FileName, contentType);
            StatusText = "已上传";
        }
        catch (Exception ex)
        {
            StatusText = $"上传失败: {ex.Message}";
        }
    }

    private void OnConnectionClosed(Exception ex)
        => StatusText = $"连接断开: {ex.Message}";

    private async Task LogoutAsync()
    {
        await _ws.DisconnectAsync();
        await _auth.LogoutAsync();
    }

    /// <summary>
    /// Disconnect from the current server and return to the server
    /// configuration page. The session token is server-specific so we log out
    /// first — the user will re-authenticate against the new server.
    /// </summary>
    private async Task SwitchServerAsync()
    {
        // Suppress auto-navigation so the logout event doesn't reroute to
        // login before we reach the server-config page.
        if (Shell.Current is AppShell shell)
            shell.SuppressAutoNavigate();

        await _ws.DisconnectAsync();
        await _auth.LogoutAsync();
        Shell.Current.GoToAsync("//server-config");
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
