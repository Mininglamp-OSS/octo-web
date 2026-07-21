using System.Net.Http.Json;
using System.Text.Json;

namespace OctoMaui.Services;

/// <summary>
/// Default update service. Fetches the server's <c>/version.json</c> static
/// file (matches packages/dmworkbase/src/Utils/versionChecker.ts) to discover
/// the latest client release. Compares semver strings and fires
/// <see cref="UpdateFound"/> when a newer version exists.
/// </summary>
public sealed class UpdateService : IUpdateService
{
    private readonly IApiService _api;
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };

    public UpdateService(IApiService api)
    {
        _api = api;
        CurrentVersion = AppInfo.VersionString;
    }

    public string CurrentVersion { get; }
    public string? LatestVersion { get; private set; }
    public string? ReleaseNotesUrl { get; private set; }
    public string? DownloadUrl { get; private set; }
    public bool UpdateAvailable { get; private set; }

    public event Action? UpdateFound;

    public async Task CheckForUpdatesAsync(CancellationToken ct = default)
    {
        try
        {
            // Reuse a long-lived static HttpClient to avoid socket exhaustion.
            // Build absolute URL to avoid mutating BaseAddress (can only be set before first request).
            var url = new Uri(new Uri(_api.BaseUrl), $"{ApiPaths.VersionJson}?_={DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
            // version.json is a static file (not an API endpoint). The
            // cache-busting query param mirrors versionChecker.ts
            // (`'/version.json?_=' + Date.now()` with `cache: 'no-store'`).
            using var resp = await _http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode) return;

            var info = await resp.Content.ReadFromJsonAsync<VersionInfo>(Json, ct);
            if (info is null || string.IsNullOrWhiteSpace(info.Version)) return;

            LatestVersion = info.Version;
            DownloadUrl = info.DownloadUrl;
            ReleaseNotesUrl = info.ReleaseNotesUrl;

            // Simple semver comparison: parse "1.2.3" into (1, 2, 3).
            UpdateAvailable = IsNewer(info.Version, CurrentVersion);
            if (UpdateAvailable)
            {
                MainThread.BeginInvokeOnMainThread(() => UpdateFound?.Invoke());
            }
        }
        catch
        {
            // Version check is best-effort — never crash on failure.
        }
    }

    /// <summary>
    /// Returns true if <paramref name="remote"/> is a newer semver than
    /// <paramref name="local"/>. Handles "1.2.3" and "v1.2.3" formats.
    /// </summary>
    internal static bool IsNewer(string remote, string local)
    {
        if (TryParseSemver(remote, out var r) && TryParseSemver(local, out var l))
        {
            if (r.major != l.major) return r.major > l.major;
            if (r.minor != l.minor) return r.minor > l.minor;
            return r.patch > l.patch;
        }
        return false;
    }

    private static bool TryParseSemver(string s, out (int major, int minor, int patch) v)
    {
        v = default;
        if (string.IsNullOrWhiteSpace(s)) return false;
        var trimmed = s.TrimStart('v', 'V');
        var parts = trimmed.Split('.', 3);
        if (parts.Length < 3) return false;
        return int.TryParse(parts[0], out v.major)
            && int.TryParse(parts[1], out v.minor)
            && int.TryParse(parts[2], out v.patch);
    }
}
