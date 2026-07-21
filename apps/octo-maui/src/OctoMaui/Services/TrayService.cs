namespace OctoMaui.Services;

/// <summary>
/// Default tray service — no-op on platforms that don't support tray icons.
/// Windows implementation is in Platforms/Windows/TrayService.cs.
/// </summary>
public sealed class TrayService : ITrayService
{
    public bool IsSupported => false;

    public Task InitializeAsync() => Task.CompletedTask;

    public void ShowWindow() { }

    public void HideWindow() { }

    public void Remove() { }
}
