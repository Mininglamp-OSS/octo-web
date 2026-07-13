using OctoMaui.Services;

namespace OctoMaui;

public partial class App : Application
{
    // Default window geometry — used the first time the app runs, before any
    // preference has been saved. Chosen to fit a typical laptop screen while
    // leaving room for the taskbar.
    private const double DefaultWidth = 1180;
    private const double DefaultHeight = 760;
    private const double MinWidth = 880;
    private const double MinHeight = 560;

    // Persistence keys for window bounds (screen-space pixel coordinates).
    private const string PrefX = "win.x";
    private const string PrefY = "win.y";
    private const string PrefW = "win.w";
    private const string PrefH = "win.h";

    /// <summary>Debounce token for SaveBounds — a drag-resize fires SizeChanged many times per second.</summary>
    private CancellationTokenSource? _saveBoundsCts;

    /// <summary>Guards against re-subscribing to AuthStateChanged on every PageAppearing.</summary>
    private bool _authTitleWired;

    public App()
    {
        InitializeComponent();
        // Resolve services after the handler has built the DI container.
        // App is created very early, so we resolve lazily on first use.
    }

    private T? Resolve<T>() where T : class
    {
        try { return Handler?.MauiContext?.Services?.GetService<T>(); }
        catch { return null; }
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        // Resolve AppShell from DI so its constructor-injected services
        // (auth, theme, server config, history) are populated.
        var shell = Resolve<AppShell>();
        if (shell is null)
        {
            var auth = Handler?.MauiContext?.Services?.GetService<IAuthService>();
            var theme = Handler?.MauiContext?.Services?.GetService<IThemeService>();
            var server = Handler?.MauiContext?.Services?.GetService<IServerConfigService>();
            var history = Handler?.MauiContext?.Services?.GetService<IServerHistoryService>();
            if (auth is null || theme is null || server is null || history is null)
                throw new InvalidOperationException("Required services are not registered in the DI container.");
            shell = new AppShell(auth, theme, server, history);
        }
        var window = new Window(shell);

        // Default size + minimum size. On Windows this maps to the Win32
        // window's initial + min track size.
        window.Width = DefaultWidth;
        window.Height = DefaultHeight;
        window.MinimumWidth = MinWidth;
        window.MinimumHeight = MinHeight;

        // Restore last saved position/size if present and on-screen.
        var savedX = Preferences.Default.Get(PrefX, double.MinValue);
        var savedY = Preferences.Default.Get(PrefY, double.MinValue);
        if (savedX != double.MinValue && savedY != double.MinValue)
        {
            // Best-effort: clamp to a positive offset so the title bar stays
            // visible even if the display setup changed since last run.
            window.X = Math.Max(savedX, 0);
            window.Y = Math.Max(savedY, 0);
            var savedW = Preferences.Default.Get(PrefW, DefaultWidth);
            var savedH = Preferences.Default.Get(PrefH, DefaultHeight);
            window.Width = Math.Max(savedW, MinWidth);
            window.Height = Math.Max(savedH, MinHeight);
        }

        // Dynamic title: updated when auth state changes (see OnPageAppearing).
        window.Title = "OCTO";

        // Persist geometry on move/resize (debounced — SizeChanged fires
        // many times per second during a drag-resize).
        window.SizeChanged += (_, _) => SaveBoundsDebounced(window);
        window.PageAppearing += OnPageAppearing;

        // Initialize system tray + update check once DI is ready.
        _ = InitializeTrayAndUpdatesAsync(window);

        return window;
    }

    private async Task InitializeTrayAndUpdatesAsync(Window window)
    {
        // Wait for the window's handler (and thus the DI container) to be
        // ready instead of relying on a fixed delay. HandlerChanged fires
        // once the native window is created and services are available.
        if (window.Handler is null)
        {
            var tcs = new TaskCompletionSource<bool>();
            void OnHandlerChanged(object? s, EventArgs e) => tcs.TrySetResult(true);
            window.HandlerChanged += OnHandlerChanged;
            await tcs.Task;
            window.HandlerChanged -= OnHandlerChanged;
        }

        // --- System tray ---
        var tray = Resolve<ITrayService>();
        if (tray is { IsSupported: true })
        {
            await tray.InitializeAsync();
            // Minimize to tray instead of taskbar when the window is hidden.
            window.Destroying += (_, _) => tray.Remove();
        }

        // --- Auto-update check (non-blocking) ---
        var update = Resolve<IUpdateService>();
        if (update is not null)
        {
            update.UpdateFound += () =>
                MainThread.BeginInvokeOnMainThread(async () =>
                {
                    if (window.Page is { } page)
                    {
                        var ok = await page.DisplayAlert(
                            "发现新版本",
                            $"当前版本 {update.CurrentVersion}，最新版本 {update.LatestVersion}。\n" +
                            $"点击确定打开下载页面。",
                            "确定", "稍后");
                        if (ok && update.DownloadUrl is { } url
                            && Uri.TryCreate(url, UriKind.Absolute, out var dlUri)
                            && (dlUri.Scheme == "http" || dlUri.Scheme == "https"))
                        {
                            await Browser.OpenAsync(url);
                        }
                    }
                });
            _ = update.CheckForUpdatesAsync();
        }
    }

    private void OnPageAppearing(object? sender, EventArgs e)
    {
        if (sender is not Window window) return;

        // Resolve auth once DI is ready and wire up dynamic title updates.
        var auth = Resolve<IAuthService>();
        if (auth is null) return;

        // Subscribe only once — PageAppearing can fire multiple times.
        if (_authTitleWired) { UpdateTitle(window, auth); return; }
        _authTitleWired = true;
        auth.AuthStateChanged += (_, _) =>
            MainThread.BeginInvokeOnMainThread(() => UpdateTitle(window, auth));
        UpdateTitle(window, auth);
    }

    private static void UpdateTitle(Window window, IAuthService auth)
    {
        // "OCTO" when logged out, "OCTO — <user>" when logged in.
        window.Title = auth.IsAuthenticated && auth.CurrentUser is { } u
            ? $"OCTO — {u.DisplayName}"
            : "OCTO";
    }

    /// <summary>
    /// Debounce SaveBounds by 500ms so a drag-resize (which fires SizeChanged
    /// many times per second) doesn't cause a persistent-store write storm.
    /// </summary>
    private void SaveBoundsDebounced(Window window)
    {
        _saveBoundsCts?.Cancel();
        _saveBoundsCts = new CancellationTokenSource();
        var ct = _saveBoundsCts.Token;
        _ = Task.Delay(500, ct).ContinueWith(t =>
        {
            if (t.IsFaulted) return;
            if (!ct.IsCancellationRequested)
                MainThread.BeginInvokeOnMainThread(() => SaveBounds(window));
        }, TaskScheduler.Default);
    }

    private static void SaveBounds(Window window)
    {
        try
        {
            Preferences.Default.Set(PrefX, window.X);
            Preferences.Default.Set(PrefY, window.Y);
            Preferences.Default.Set(PrefW, window.Width);
            Preferences.Default.Set(PrefH, window.Height);
        }
        catch
        {
            // Preferences can throw on platforms without secure storage; ignore.
        }
    }
}
