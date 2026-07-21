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
public sealed class ChatViewModel : ViewModelBase, IDisposable
{
    private readonly IAuthService _auth;
    private readonly IApiService _api;
    private readonly IWebSocketService _ws;
    private readonly IThemeService _theme;

    /// <summary>Tracks the streaming message being built (messageId -> Message).</summary>
    private readonly Dictionary<string, Message> _streamingMessages = new();

    /// <summary>Cancels the previous LoadMessagesAsync when switching channels.</summary>
    private CancellationTokenSource? _loadMessagesCts;

    /// <summary>Guard to make Dispose idempotent.</summary>
    private bool _disposed;

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
        AttachFileCommand = CreateCommand(async () => await AttachFileAsync(), () => !IsUploading && SelectedChannel is not null);
        AttachImageCommand = CreateCommand(async () => await AttachImageAsync(), () => !IsUploading && SelectedChannel is not null);

        _ws.MessageReceived += OnMessageReceived;
        _ws.StreamStarted += OnStreamStarted;
        _ws.StreamChunkReceived += OnStreamChunkReceived;
        _ws.StreamEnded += OnStreamEnded;
        _ws.ConnectionClosed += OnConnectionClosed;
        _theme.ThemeChanged += OnThemeChanged;
        Messages.CollectionChanged += (_, _) => IsEmpty = Messages.Count == 0;
        StatusText = string.Empty;  // CS8050: can't use property initializer
        RefreshThemeLabel();        // sets ThemeLabel based on current theme
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
                // Cancel any in-flight message load before starting a new one.
                _loadMessagesCts?.Cancel();
                _loadMessagesCts?.Dispose();
                _loadMessagesCts = new CancellationTokenSource();
                _ = LoadMessagesAsync(_loadMessagesCts.Token);
            }
        }
    }

    public string Draft { get => Get<string>(); set { Set(value); ((Command)SendCommand).ChangeCanExecute(); } }
    public bool IsLoading { get => Get<bool>(); set => Set(value); }
    public string StatusText { get => Get<string>(); set => Set(value); }

    /// <summary>True when an AI agent is actively streaming a reply (typing indicator).</summary>
    public bool IsAgentTyping
    {
        get => Get<bool>();
        set => Set(value);
    }

    /// <summary>True while a file/image upload is in progress (disables attachment buttons).</summary>
    public bool IsUploading
    {
        get => Get<bool>();
        set
        {
            Set(value);
            ((Command)AttachFileCommand).ChangeCanExecute();
            ((Command)AttachImageCommand).ChangeCanExecute();
        }
    }

    /// <summary>True when files are being dragged over the drop area.</summary>
    public bool IsDragOver
    {
        get => Get<bool>();
        set => Set(value);
    }

    /// <summary>Localized label for the theme toggle button.</summary>
    public string ThemeLabel { get => Get<string>(); set => Set(value); }

    public ICommand SendCommand { get; }
    public ICommand LogoutCommand { get; }
    public ICommand ToggleThemeCommand { get; }
    public ICommand SwitchServerCommand { get; }
    public ICommand AttachFileCommand { get; }
    public ICommand AttachImageCommand { get; }

    // --- lifecycle ---

    public async Task InitializeAsync()
    {
        try
        {
            // If the saved token is invalid, HydrateCurrentUserAsync forces
            // logout and returns false — bail out before making more requests
            // with a null token.
            if (!await _auth.HydrateCurrentUserAsync())
            {
                StatusText = "会话已过期，请重新登录";
                return;
            }
            await LoadChannelsAsync();

            if (string.IsNullOrEmpty(_auth.Token))
            {
                StatusText = "未登录，请重新登录";
                return;
            }

            await _ws.ConnectAsync(_auth.Token!);
            StatusText = "已连接";
        }
        catch (Exception ex)
        {
            StatusText = $"初始化失败: {ex.Message}";
        }
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

    private async Task LoadMessagesAsync(CancellationToken ct)
    {
        if (SelectedChannel is null) return;
        IsLoading = true;
        try
        {
            var msgs = await _api.GetMessagesAsync(_auth.Token!, SelectedChannel.Id, limit: 50, ct: ct);
            if (ct.IsCancellationRequested) return;
            // Clear streaming placeholders from the previous channel — they
            // hold references to Message objects no longer in the collection.
            _streamingMessages.Clear();
            Messages.Clear();
            foreach (var m in msgs) Messages.Add(m);
        }
        catch (OperationCanceledException)
        {
            // Channel switched — ignore the stale result.
        }
        catch (Exception ex)
        {
            if (!ct.IsCancellationRequested)
                StatusText = $"加载消息失败: {ex.Message}";
        }
        finally
        {
            if (!ct.IsCancellationRequested)
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
            // Optimistic local echo with a client-generated temp id so we
            // can de-dup when the server echoes the canonical message back.
            Messages.Add(new Message
            {
                Id = "local-" + Guid.NewGuid().ToString("N"),
                ChannelId = SelectedChannel.Id,
                FromUid = _auth.CurrentUser?.Id ?? string.Empty,
                SenderName = _auth.CurrentUser?.DisplayName ?? string.Empty,
                Content = content,
                TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            });
        }
        catch (Exception ex)
        {
            // Restore the draft so the user doesn't lose their typed text.
            Draft = content;
            StatusText = $"发送失败: {ex.Message}";
        }
    }

    private void OnMessageReceived(Message msg)
    {
        if (msg.ChannelId != SelectedChannel?.Id) return;

        // De-dup: if the server echoes back a message we just optimistically
        // added locally (same sender + content), remove the local echo.
        if (msg.FromUid == _auth.CurrentUser?.Id)
        {
            var echo = Messages.FirstOrDefault(m =>
                m.Id.StartsWith("local-") && m.Content == msg.Content);
            if (echo is not null)
                Messages.Remove(echo);
        }

        // If this is the final version of a streamed message, remove the
        // streaming placeholder before adding the complete one.
        if (!string.IsNullOrEmpty(msg.Id) && _streamingMessages.TryGetValue(msg.Id, out var placeholder))
        {
            Messages.Remove(placeholder);
            _streamingMessages.Remove(msg.Id);
        }
        Messages.Add(msg);
    }

    // --- streaming reply handling ---

    private void OnStreamStarted(string messageId)
    {
        if (string.IsNullOrEmpty(messageId)) return;
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
        if (string.IsNullOrEmpty(messageId)) return;
        // Message now implements INotifyPropertyChanged, so setting Content
        // directly triggers the UI update without replacing the item.
        if (_streamingMessages.TryGetValue(messageId, out var msg))
        {
            msg.Content += chunk;
        }
    }

    private void OnStreamEnded(string messageId)
    {
        IsAgentTyping = false;
        if (!string.IsNullOrEmpty(messageId) && _streamingMessages.TryGetValue(messageId, out var msg))
        {
            msg.IsStreaming = false;
            _streamingMessages.Remove(messageId);
        }
    }

    // --- file / image upload ---

    private async Task AttachFileAsync()
    {
        if (SelectedChannel is null || IsUploading) return;
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
            var fileSize = stream.CanSeek ? stream.Length : 0;
            IsUploading = true;
            StatusText = "正在上传文件…";
            // UploadFileAsync now returns the download URL (string) instead of
            // a full Message — we build a local placeholder Message from it so
            // the attachment shows up immediately in the chat surface.
            var downloadUrl = await _api.UploadFileAsync(_auth.Token!, SelectedChannel.Id, SelectedChannel.Type, stream, result.FileName, contentType);
            AddUploadedMessage(MessageType.File, result.FileName, downloadUrl, fileSize);
            StatusText = "已上传";
        }
        catch (Exception ex)
        {
            StatusText = $"上传失败: {ex.Message}";
        }
        finally
        {
            IsUploading = false;
        }
    }

    private async Task AttachImageAsync()
    {
        if (SelectedChannel is null || IsUploading) return;
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
            var fileSize = stream.CanSeek ? stream.Length : 0;
            IsUploading = true;
            StatusText = "正在上传图片…";
            var downloadUrl = await _api.UploadFileAsync(_auth.Token!, SelectedChannel.Id, SelectedChannel.Type, stream, result.FileName, contentType);
            AddUploadedMessage(MessageType.Image, result.FileName, downloadUrl, fileSize);
            StatusText = "已上传";
        }
        catch (Exception ex)
        {
            StatusText = $"上传失败: {ex.Message}";
        }
        finally
        {
            IsUploading = false;
        }
    }

    /// <summary>
    /// Handle files dropped onto the chat area. Called from the
    /// DropGestureRecognizer in ChatPage.xaml.
    /// </summary>
    public async Task HandleDropAsync(IEnumerable<string> filePaths)
    {
        if (SelectedChannel is null || IsUploading) return;
        // Set IsUploading once for the entire batch — resetting it per file
        // would flip the indicator false between files and defeat the
        // single-flight guard.
        IsUploading = true;
        try
        {
            foreach (var path in filePaths)
            {
                try
                {
                    using var stream = File.OpenRead(path);
                    var fileName = Path.GetFileName(path);
                    var contentType = GuessContentType(fileName);
                    var fileSize = new FileInfo(path).Length;
                    StatusText = $"正在上传 {fileName}…";
                    var downloadUrl = await _api.UploadFileAsync(_auth.Token!, SelectedChannel.Id, SelectedChannel.Type, stream, fileName, contentType);
                    var msgType = contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
                        ? MessageType.Image : MessageType.File;
                    AddUploadedMessage(msgType, fileName, downloadUrl, fileSize);
                }
                catch (Exception ex)
                {
                    StatusText = $"上传失败: {ex.Message}";
                    // Continue with remaining files.
                }
            }
            StatusText = "上传完成";
        }
        finally
        {
            IsUploading = false;
        }
    }

    /// <summary>
    /// Append a local placeholder Message for a just-uploaded attachment.
    /// Uses a client-generated temp id (matching the optimistic-echo pattern
    /// in <see cref="SendAsync"/>) so it can be de-duped if the server later
    /// pushes the canonical copy.
    /// </summary>
    private void AddUploadedMessage(MessageType type, string fileName, string downloadUrl, long fileSize)
    {
        if (SelectedChannel is null || string.IsNullOrEmpty(downloadUrl)) return;
        Messages.Add(new Message
        {
            Id = "local-" + Guid.NewGuid().ToString("N"),
            ChannelId = SelectedChannel.Id,
            FromUid = _auth.CurrentUser?.Id ?? string.Empty,
            SenderName = _auth.CurrentUser?.DisplayName ?? string.Empty,
            Type = type,
            Content = "",
            Url = downloadUrl,
            FileName = fileName,
            FileSize = fileSize,
            TimestampMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        });
    }

    /// <summary>
    /// Guesses the content type from the file extension.
    /// NOTE: The server SHOULD validate file type via magic bytes, not rely
    /// on client-provided extensions, to prevent spoofing.
    /// </summary>
    private static string GuessContentType(string fileName)
    {
        var ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".png" => "image/png",
            ".jpg" or ".jpeg" => "image/jpeg",
            ".gif" => "image/gif",
            ".svg" => "image/svg+xml",
            ".pdf" => "application/pdf",
            ".zip" => "application/zip",
            ".json" => "application/json",
            ".xml" => "application/xml",
            ".txt" or ".md" => "text/plain",
            _ => "application/octet-stream",
        };
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

    private void OnThemeChanged(object? sender, EventArgs e)
        => MainThread.BeginInvokeOnMainThread(RefreshThemeLabel);

    // --- IDisposable ---

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        // Unsubscribe from singleton service events to prevent the
        // Transient ViewModel from being kept alive by them.
        _ws.MessageReceived -= OnMessageReceived;
        _ws.StreamStarted -= OnStreamStarted;
        _ws.StreamChunkReceived -= OnStreamChunkReceived;
        _ws.StreamEnded -= OnStreamEnded;
        _ws.ConnectionClosed -= OnConnectionClosed;
        _theme.ThemeChanged -= OnThemeChanged;

        _loadMessagesCts?.Cancel();
        _loadMessagesCts?.Dispose();

        GC.SuppressFinalize(this);
    }
}
