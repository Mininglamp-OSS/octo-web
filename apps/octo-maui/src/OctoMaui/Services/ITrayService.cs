namespace OctoMaui.Services;

/// <summary>
/// System tray integration. On Windows, shows a tray icon with context menu
/// (Show / Hide / Quit). Minimizing the window hides it to tray instead of
/// the taskbar. On non-Windows platforms this is a no-op.
/// </summary>
public interface ITrayService
{
    /// <summary>True if the platform supports a system tray.</summary>
    bool IsSupported { get; }

    /// <summary>Initialize the tray icon and menu.</summary>
    Task InitializeAsync();

    /// <summary>Show the main window (restore from tray).</summary>
    void ShowWindow();

    /// <summary>Hide the main window to tray.</summary>
    void HideWindow();

    /// <summary>Remove the tray icon (on shutdown).</summary>
    void Remove();
}
