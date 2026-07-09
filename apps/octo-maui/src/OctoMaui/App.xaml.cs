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

    private readonly IAuthService? _auth;

    public App()
    {
        InitializeComponent();
        // Resolve services after the handler has built the DI container.
        // App is created very early, so we resolve lazily on first use.
    }

    private IAuthService? ResolveAuth()
    {
        try
        {
            return Handler?.MauiContext?.Services?.GetService<IAuthService>();
        }
        catch
        {
            return null;
        }
    }

    protected override Window CreateWindow(IActivationState? activationState)
    {
        var window = new Window(new AppShell());

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

        // Persist geometry on move/resize so the next launch restores it.
        window.SizeChanged += (_, _) => SaveBounds(window);
        window.PageAppearing += OnPageAppearing;

        return window;
    }

    private void OnPageAppearing(object? sender, EventArgs e)
    {
        if (sender is not Window window) return;

        // Resolve auth once DI is ready and wire up dynamic title updates.
        var auth = _auth ?? ResolveAuth();
        if (auth is null) return;

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
