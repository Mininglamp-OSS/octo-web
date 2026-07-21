using System.Collections.ObjectModel;
using System.Windows.Input;
using OctoMaui.Models;
using OctoMaui.Services;

namespace OctoMaui.ViewModels;

/// <summary>
/// View model for the server configuration page. Provides a guided
/// initialization flow: enter a server address → verify connection → preview
/// server capabilities → save and continue. Also supports quick-reconnect via
/// saved history entries.
/// </summary>
public sealed class ServerConfigViewModel : ViewModelBase, IDisposable
{
    private readonly IServerConfigService _server;
    private readonly IThemeService _theme;
    private readonly IServerHistoryService _history;
    private readonly EventHandler _themeChangedHandler;
    private readonly EventHandler _historyChangedHandler;
    private bool _disposed;

    public ServerConfigViewModel(IServerConfigService server, IThemeService theme, IServerHistoryService history)
    {
        _server = server;
        _theme = theme;
        _history = history;

        // Assign commands BEFORE pre-filling ServerUrl — the ServerUrl
        // setter calls ChangeCanExecute on these, which would NRE if they
        // were still null.
        VerifyCommand = CreateCommand(async () => await VerifyAsync(),
            () => !IsBusy && !string.IsNullOrWhiteSpace(ServerUrl));
        ContinueCommand = CreateCommand(async () => await ContinueAsync(),
            () => !IsBusy && IsVerified);
        SelectRecentCommand = CreateCommand<ServerHistoryEntry>(async e => await SelectRecentAsync(e!), _ => !IsBusy);
        RemoveRecentCommand = CreateCommand<ServerHistoryEntry>(async e => await RemoveRecentAsync(e!), _ => !IsBusy);
        ToggleThemeCommand = CreateCommand(async () => await ToggleThemeAsync());

        // CS8050: can't use property initializers on non-auto properties,
        // so set defaults here in the ctor.
        StepStatus = string.Empty;
        ErrorMessage = string.Empty;

        // Pre-fill with the current URL if already configured.
        ServerUrl = _server.ServerUrl;

        _themeChangedHandler = (_, _) => MainThread.BeginInvokeOnMainThread(RefreshThemeLabel);
        _historyChangedHandler = (_, _) => MainThread.BeginInvokeOnMainThread(RefreshHistory);
        _theme.ThemeChanged += _themeChangedHandler;
        _history.Changed += _historyChangedHandler;
        RefreshThemeLabel();  // sets ThemeLabel based on current theme
        RefreshHistory();
    }

    // --- input ---

    /// <summary>User-entered server domain / URL.</summary>
    public string ServerUrl
    {
        get => Get<string>();
        set
        {
            Set(value);
            // Editing the URL invalidates any previous verification.
            if (IsVerified) IsVerified = false;
            if (HasPreview) { PreviewInfo = null; OnPropertyChanged(nameof(HasPreview)); }
            ((Command)VerifyCommand).ChangeCanExecute();
            ((Command)ContinueCommand).ChangeCanExecute();
        }
    }

    public bool IsBusy { get => Get<bool>(); set { Set(value); RefreshCanExecute(); } }

    // --- step-by-step verification status ---

    /// <summary>Current step description shown next to the spinner.</summary>
    public string StepStatus { get => Get<string>(); set => Set(value); }

    public bool HasError { get => Get<bool>(); set => Set(value); }
    public string ErrorMessage { get => Get<string>(); set => Set(value); }

    /// <summary>True after a successful verification (ping + config probe).</summary>
    public bool IsVerified
    {
        get => Get<bool>();
        set
        {
            Set(value);
            ((Command)ContinueCommand).ChangeCanExecute();
        }
    }

    // --- capability preview ---

    /// <summary>Server capabilities discovered during verification.</summary>
    public ServerInfo? PreviewInfo
    {
        get => Get<ServerInfo?>();
        set
        {
            Set(value);
            OnPropertyChanged(nameof(HasPreview));
            OnPropertyChanged(nameof(PreviewAuthModes));
            OnPropertyChanged(nameof(PreviewOidcNames));
        }
    }

    public bool HasPreview => PreviewInfo is not null;

    /// <summary>Summary of available login methods, e.g. "企业 SSO · 账号密码".</summary>
    public string PreviewAuthModes
    {
        get
        {
            if (PreviewInfo is not { } info) return "";
            var modes = new List<string>();
            if (info.HasOidcProviders)
                modes.Add("企业 SSO");
            // Hide "账号密码" when the server has disabled legacy password
            // login (legacy_password_login_off in appconfig).
            if (!info.LegacyPasswordLoginOff)
                modes.Add("账号密码");
            return string.Join(" · ", modes);
        }
    }

    /// <summary>Comma-separated OIDC provider names, or empty.</summary>
    public string PreviewOidcNames
    {
        get => PreviewInfo is { HasOidcProviders: true } info
            ? string.Join(", ", info.OidcProviders.Select(p => p.Name))
            : "";
    }

    // --- history ---

    public ObservableCollection<ServerHistoryEntry> RecentServers { get; } = new();
    public bool HasRecentServers { get => Get<bool>(); set => Set(value); }

    // --- theme ---

    public string ThemeLabel { get => Get<string>(); set => Set(value); }

    // --- commands ---

    public ICommand VerifyCommand { get; }
    public ICommand ContinueCommand { get; }
    public ICommand SelectRecentCommand { get; }
    public ICommand RemoveRecentCommand { get; }
    public ICommand ToggleThemeCommand { get; }

    // --- verification flow ---

    private async Task VerifyAsync()
    {
        IsBusy = true;
        HasError = false;
        ErrorMessage = string.Empty;
        IsVerified = false;
        PreviewInfo = null;

        // Step 1: Ping the server.
        StepStatus = "正在连接服务器…";
        try
        {
            var ok = await _server.ValidateAsync(ServerUrl);
            if (!ok)
            {
                HasError = true;
                ErrorMessage = "无法连接到服务器，请检查地址是否正确";
                StepStatus = string.Empty;
                IsBusy = false;
                return;
            }
        }
        catch (Exception ex)
        {
            HasError = true;
            ErrorMessage = $"连接失败: {ex.Message}";
            StepStatus = string.Empty;
            IsBusy = false;
            return;
        }

        // Step 2: Probe server config (appconfig) WITHOUT saving the URL.
        // ProbeAsync uses a self-contained HttpClient to hit the candidate
        // URL's /v1/common/appconfig — the shared ApiService / ApiOptions
        // state is NOT mutated, so the ServerChanged event is NOT raised and
        // we stay on this page.
        StepStatus = "正在获取服务端配置…";
        ServerInfo? info;
        try
        {
            info = await _server.ProbeAsync(ServerUrl);
            if (info is null)
            {
                HasError = true;
                ErrorMessage = "无法获取服务端配置，请检查地址";
                StepStatus = string.Empty;
                IsBusy = false;
                return;
            }
        }
        catch (Exception ex)
        {
            // Non-fatal: fall back to local-only login.
            info = new ServerInfo();
            _ = ex; // suppress unused warning
        }

        // Step 3: Show the preview.
        StepStatus = "连接成功，请确认服务端能力";
        PreviewInfo = info;
        IsVerified = true;
        IsBusy = false;
    }

    private async Task ContinueAsync()
    {
        if (!IsVerified) return;

        IsBusy = true;
        StepStatus = "正在保存并跳转…";
        try
        {
            // Persist the URL — SetServerUrlAsync raises ServerChanged which
            // triggers AppShell to navigate to the login page.
            var ok = await _server.SetServerUrlAsync(ServerUrl);
            if (!ok)
            {
                HasError = true;
                ErrorMessage = "保存失败：服务器不可达，请重试";
                StepStatus = string.Empty;
                return;
            }

            // Record in history (best-effort, non-blocking).
            try { await _history.AddAsync(ServerUrl); }
            catch { /* ignore */ }
        }
        catch (Exception ex)
        {
            HasError = true;
            ErrorMessage = $"保存失败: {ex.Message}";
            StepStatus = string.Empty;
        }
        finally { IsBusy = false; }
    }

    private async Task SelectRecentAsync(ServerHistoryEntry entry)
    {
        ServerUrl = entry.Url;
        await VerifyAsync();
    }

    private async Task RemoveRecentAsync(ServerHistoryEntry entry)
    {
        await _history.RemoveAsync(entry.Url);
    }

    // --- helpers ---

    private void RefreshHistory()
    {
        RecentServers.Clear();
        foreach (var e in _history.Entries)
            RecentServers.Add(e);
        HasRecentServers = RecentServers.Count > 0;
    }

    private void RefreshCanExecute()
    {
        ((Command)VerifyCommand).ChangeCanExecute();
        ((Command)ContinueCommand).ChangeCanExecute();
        ((Command)SelectRecentCommand).ChangeCanExecute();
        ((Command)RemoveRecentCommand).ChangeCanExecute();
    }

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

    // --- IDisposable ---

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _theme.ThemeChanged -= _themeChangedHandler;
        _history.Changed -= _historyChangedHandler;
        GC.SuppressFinalize(this);
    }
}
