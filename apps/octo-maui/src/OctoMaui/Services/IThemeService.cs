namespace OctoMaui.Services;

/// <summary>
/// Application color theme management. Supports three modes: Light, Dark, and
/// System (which follows the OS theme at runtime).
/// </summary>
public interface IThemeService
{
    /// <summary>Current theme mode. <c>Unspecified</c> means follow the OS.</summary>
    AppTheme Mode { get; }

    /// <summary>Raised on the UI thread whenever the effective theme changes.</summary>
    event EventHandler? ThemeChanged;

    /// <summary>Load the saved preference and apply it. Call once at startup.</summary>
    Task InitializeAsync();

    /// <summary>Persist and apply a new mode. <c>Unspecified</c> = follow system.</summary>
    Task SetModeAsync(AppTheme mode);
}
