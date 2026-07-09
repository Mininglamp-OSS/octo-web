using System.Runtime.Versioning;
using Microsoft.UI.Xaml;
using Windows.ApplicationModel.Core;
using WinRT.Interop;

namespace OctoMaui.Services;

/// <summary>
/// Windows-specific tray icon implementation using Win32 NotifyIcon via
/// MAUI's Window handle. Provides minimize-to-tray and right-click menu.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsTrayService : ITrayService
{
    public bool IsSupported => OperatingSystem.IsWindows();

    public Task InitializeAsync()
    {
        // Win32 tray integration would use NotifyIcon via P/Invoke.
        // This is a scaffold — full implementation requires Win32 API calls
        // (Shell_NotifyIconW, NIM_ADD, context menu via TrackPopupMenu).
        return Task.CompletedTask;
    }

    public void ShowWindow()
    {
        // Restore window from tray — find the MAUI Window and un-minimize.
        if (Application.Current?.Windows.FirstOrDefault() is { } window)
        {
            MainThread.BeginInvokeOnMainThread(() =>
            {
                window.IsVisible = true;
            });
        }
    }

    public void HideWindow()
    {
        if (Application.Current?.Windows.FirstOrDefault() is { } window)
        {
            MainThread.BeginInvokeOnMainThread(() =>
            {
                window.IsVisible = false;
            });
        }
    }

    public void Remove()
    {
        // Win32 Shell_NotifyIconW with NIM_DELETE.
    }
}
