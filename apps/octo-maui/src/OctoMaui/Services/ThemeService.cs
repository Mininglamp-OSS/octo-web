using OctoMaui.Resources;

namespace OctoMaui.Services;

/// <summary>
/// Theme service that persists the user's choice and retints the app by
/// merging <c>ColorsDark</c> on top of the always-present light palette from
/// <c>Colors.xaml</c>. When <see cref="Mode"/> is <c>Unspecified</c> the
/// effective theme tracks the OS theme at runtime.
/// </summary>
public sealed class ThemeService : IThemeService
{
    private const string PrefKey = "theme.mode";

    private readonly ColorsDark _darkColors = new();
    private bool _darkMerged;

    public AppTheme Mode { get; private set; } = AppTheme.Unspecified;

    public event EventHandler? ThemeChanged;

    public Task InitializeAsync()
    {
        // Read saved preference (defaults to "follow system").
        var saved = Preferences.Default.Get(PrefKey, (int)AppTheme.Unspecified);
        Mode = (AppTheme)saved;
        ApplyTheme();
        // Track OS theme changes when in System mode.
        if (Application.Current is not null)
            Application.Current.RequestedThemeChanged += OnRequestedThemeChanged;
        return Task.CompletedTask;
    }

    public Task SetModeAsync(AppTheme mode)
    {
        Mode = mode;
        Preferences.Default.Set(PrefKey, (int)mode);
        ApplyTheme();
        return Task.CompletedTask;
    }

    private void OnRequestedThemeChanged(object? sender, AppThemeChangedEventArgs e)
    {
        // Only react when the user chose to follow the system.
        if (Mode == AppTheme.Unspecified)
            MainThread.BeginInvokeOnMainThread(ApplyTheme);
    }

    private void ApplyTheme()
    {
        var app = Application.Current;
        if (app is null) return;

        // Determine the effective theme. In System mode we mirror the OS.
        var effective = Mode == AppTheme.Unspecified
            ? app.RequestedTheme
            : Mode;

        // Also set UserAppTheme so platform chrome (title bar, etc.) matches
        // on platforms that respect it.
        app.UserAppTheme = Mode;

        EnsureDarkMerged(effective == AppTheme.Dark);
        ThemeChanged?.Invoke(this, EventArgs.Empty);
    }

    private void EnsureDarkMerged(bool merge)
    {
        var app = Application.Current;
        if (app is null) return;

        if (merge && !_darkMerged)
        {
            app.Resources.MergedDictionaries.Add(_darkColors);
            _darkMerged = true;
        }
        else if (!merge && _darkMerged)
        {
            app.Resources.MergedDictionaries.Remove(_darkColors);
            _darkMerged = false;
        }
    }
}
