using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Checks for client updates by querying the server's version endpoint.
/// Non-blocking — runs on startup and exposes an event when an update is found.
/// </summary>
public interface IUpdateService
{
    /// <summary>Current installed version (from ApplicationDisplayVersion).</summary>
    string CurrentVersion { get; }

    /// <summary>Latest version available on the server, or null if not checked yet.</summary>
    string? LatestVersion { get; }

    /// <summary>True if an update is available (LatestVersion > CurrentVersion).</summary>
    bool UpdateAvailable { get; }

    /// <summary>Release notes / changelog URL for the latest version.</summary>
    string? ReleaseNotesUrl { get; }

    /// <summary>Download URL for the latest version.</summary>
    string? DownloadUrl { get; }

    /// <summary>Fired when an update check completes and a newer version is found.</summary>
    event Action? UpdateFound;

    /// <summary>Check for updates against the current server. Non-throwing.</summary>
    Task CheckForUpdatesAsync(CancellationToken ct = default);
}

/// <summary>Version info returned by the server's version endpoint.</summary>
public sealed class VersionInfo
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = string.Empty;

    [JsonPropertyName("download_url")]
    public string? DownloadUrl { get; set; }

    [JsonPropertyName("release_notes")]
    public string? ReleaseNotes { get; set; }

    [JsonPropertyName("release_url")]
    public string? ReleaseUrl { get; set; }

    [JsonPropertyName("min_required")]
    public string? MinRequired { get; set; }
}
