using OctoMaui.Services;

namespace OctoMaui;

public partial class AppShell : Shell
{
    private readonly IAuthService _auth;
    private readonly IThemeService _theme;

    public AppShell(IAuthService auth, IThemeService theme)
    {
        _auth = auth;
        _theme = theme;
        InitializeComponent();

        Routing.RegisterRoute("login", typeof(Pages.LoginPage));
        Routing.RegisterRoute("chat", typeof(Pages.ChatPage));

        // Route to the right page based on auth state.
        _auth.AuthStateChanged += OnAuthStateChanged;
        NavigateByAuthState();

        // Apply the saved theme as early as possible to avoid a flash of the
        // default light palette on dark-mode users.
        _ = _theme.InitializeAsync();
    }

    private void OnAuthStateChanged(object? sender, EventArgs _)
        => MainThread.BeginInvokeOnMainThread(NavigateByAuthState);

    private void NavigateByAuthState()
    {
        var route = _auth.IsAuthenticated ? "chat" : "login";
        Current.GoToAsync($"//{route}");
    }
}
