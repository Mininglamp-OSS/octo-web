using OctoMaui.Services;

namespace OctoMaui;

public partial class AppShell : Shell
{
    private readonly IAuthService _auth;
    private readonly IThemeService _theme;
    private readonly IServerConfigService _server;
    private readonly IServerHistoryService _history;

    /// <summary>
    /// Set by <see cref="SuppressAutoNavigate"/> when the user explicitly
    /// switches server. While true, <see cref="Navigate"/> is a no-op so that
    /// the AuthStateChanged event raised by logout doesn't pull the user back
    /// to the login page. Cleared when a new server is saved.
    /// </summary>
    private bool _suppressAutoNavigate;

    public AppShell(IAuthService auth, IThemeService theme, IServerConfigService server, IServerHistoryService history)
    {
        _auth = auth;
        _theme = theme;
        _server = server;
        _history = history;

        InitializeComponent();

        Routing.RegisterRoute("server-config", typeof(Pages.ServerConfigPage));
        Routing.RegisterRoute("login", typeof(Pages.LoginPage));
        Routing.RegisterRoute("chat", typeof(Pages.ChatPage));

        // React to all three state changes that affect routing.
        _auth.AuthStateChanged += (_, _) => MainThread.BeginInvokeOnMainThread(Navigate);
        _server.ServerChanged += OnServerChanged;

        // Apply the saved theme early to avoid a flash of the default palette.
        _ = _theme.InitializeAsync();

        // Load saved server history (best-effort, non-blocking).
        _ = _history.InitializeAsync();

        // Load any saved server URL, then navigate to the right page.
        _ = InitializeAndNavigateAsync();
    }

    /// <summary>
    /// Called by ChatViewModel when the user wants to switch server. Suppresses
    /// auto-navigation until a new server is saved, so the logout event doesn't
    /// reroute to the login page.
    /// </summary>
    public void SuppressAutoNavigate() => _suppressAutoNavigate = true;

    private void OnServerChanged(object? sender, EventArgs e)
    {
        // A new server was saved — resume normal routing.
        _suppressAutoNavigate = false;
        MainThread.BeginInvokeOnMainThread(Navigate);
    }

    private async Task InitializeAndNavigateAsync()
    {
        await _server.InitializeAsync();
        Navigate();
    }

    /// <summary>
    /// Three-tier routing:
    ///   1. No server configured → server-config
    ///   2. Server configured but not logged in → login
    ///   3. Logged in → chat
    /// </summary>
    private void Navigate()
    {
        if (_suppressAutoNavigate) return;

        var route = !_server.IsConfigured ? "server-config"
            : !_auth.IsAuthenticated ? "login"
            : "chat";
        Current.GoToAsync($"//{route}");
    }
}
