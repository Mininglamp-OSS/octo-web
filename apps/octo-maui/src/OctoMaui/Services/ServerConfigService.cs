using System.Net;
using System.Text.Json;
using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Persists the user's chosen octo-server URL in <see cref="Preferences"/> and
/// keeps <see cref="ApiOptions"/> / <see cref="IApiService"/> in sync. After
/// connecting, also probes <c>/v1/common/appconfig</c> for OIDC/SSO provider
/// configuration so the login page can show enterprise passport buttons.
/// </summary>
public sealed class ServerConfigService : IServerConfigService
{
    private const string PrefKey = "server.url";

    private readonly ApiOptions _options;
    private readonly IApiService _api;

    public ServerConfigService(ApiOptions options, IApiService api)
    {
        _options = options;
        _api = api;
    }

    /// <inheritdoc />
    public string ServerUrl { get; private set; } = string.Empty;

    /// <inheritdoc />
    public bool IsConfigured => !string.IsNullOrWhiteSpace(ServerUrl);

    /// <inheritdoc />
    public ServerInfo? ServerInfo { get; private set; }

    /// <inheritdoc />
    public event EventHandler? ServerChanged;

    /// <inheritdoc />
    public event EventHandler? ServerInfoChanged;

    /// <inheritdoc />
    public async Task InitializeAsync()
    {
        var saved = Preferences.Default.Get(PrefKey, string.Empty);
        if (!string.IsNullOrWhiteSpace(saved))
        {
            try
            {
                var normalized = ApiService.NormalizeUrl(saved);
                ServerUrl = normalized;
                _options.BaseUrl = normalized;
                _api.UpdateBaseUrl(normalized);
            }
            catch
            {
                // Corrupted preference — clear it so the user is prompted again.
                Preferences.Default.Remove(PrefKey);
                return;
            }
        }

        // Probe capabilities (OIDC providers etc.) if a server is configured.
        await ProbeServerInfoAsync();
    }

    /// <inheritdoc />
    public async Task<bool> SetServerUrlAsync(string url, CancellationToken ct = default)
    {
        string normalized;
        try
        {
            normalized = ApiService.NormalizeUrl(url);
        }
        catch (ArgumentException)
        {
            return false;
        }

        // Validate reachability before committing.
        if (!await _api.PingAsync(normalized, ct))
            return false;

        ServerUrl = normalized;
        _options.BaseUrl = normalized;
        _api.UpdateBaseUrl(normalized);
        Preferences.Default.Set(PrefKey, normalized);

        RaiseChanged();

        // Probe appconfig for OIDC providers (non-fatal if it fails).
        await ProbeServerInfoAsync();

        return true;
    }

    /// <inheritdoc />
    public Task<bool> ValidateAsync(string url, CancellationToken ct = default)
    {
        return _api.PingAsync(url, ct);
    }

    /// <inheritdoc />
    /// <remarks>
    /// Uses a self-contained <see cref="HttpClient"/> pointed at the candidate
    /// URL — it does NOT swap <see cref="IApiService"/>'s BaseUrl or mutate
    /// <see cref="ApiOptions"/>. This avoids the concurrency risk of
    /// temporarily repointing the shared ApiService while another caller
    /// (e.g. an in-flight chat request) is relying on the current URL. The
    /// probe issues a single <c>GET /v1/common/appconfig</c>: a 2xx response
    /// proves both reachability and that the host is an octo-server, and the
    /// body carries the OIDC provider list.
    /// </remarks>
    public async Task<ServerInfo?> ProbeAsync(string url, CancellationToken ct = default)
    {
        string normalized;
        try
        {
            normalized = ApiService.NormalizeUrl(url);
        }
        catch (ArgumentException)
        {
            return null;
        }

        // Local HttpClient — no mutation of _api / _options state.
        using var probe = CreateProbeClient(normalized, TimeSpan.FromSeconds(5));
        try
        {
            using var resp = await probe.GetAsync("/v1/common/appconfig", ct);
            if (!resp.IsSuccessStatusCode) return null;
            using var doc = await JsonDocument.ParseAsync(await resp.Content.ReadAsStreamAsync(ct), ct);
            return ParseServerInfo(doc.RootElement);
        }
        catch
        {
            // Connection failure or malformed payload — treat as unreachable.
            return null;
        }
    }

    // --- helpers ---

    /// <summary>
    /// Build a standalone <see cref="HttpClient"/> for probing a candidate
    /// server URL without touching the shared ApiService. Mirrors the
    /// AllowInsecureSsl behavior (loopback-only bypass) of
    /// <see cref="ApiService"/>.
    /// </summary>
    private HttpClient CreateProbeClient(string baseUrl, TimeSpan timeout)
    {
        var handler = new HttpClientHandler();
        if (_options.AllowInsecureSsl)
        {
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) =>
            {
                if (message.RequestUri is { } uri && IsLoopback(uri.Host))
                    return true;  // Allow self-signed for localhost only
                return false;  // Remote hosts must have valid certs
            };
        }
        return new HttpClient(handler) { BaseAddress = new Uri(baseUrl), Timeout = timeout };
    }

    private static bool IsLoopback(string host)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;
        if (IPAddress.TryParse(host, out var ip))
            return IPAddress.IsLoopback(ip);
        return false;
    }

    /// <summary>
    /// Parse the <c>/v1/common/appconfig</c> JSON root into a
    /// <see cref="ServerInfo"/>. Mirrors <see cref="ApiService.GetServerInfoAsync"/>
    /// so the probe can run against a candidate URL without delegating to the
    /// shared ApiService (which would require mutating its BaseUrl).
    /// </summary>
    private static ServerInfo ParseServerInfo(JsonElement root)
    {
        var info = new ServerInfo();
        if (root.ValueKind != JsonValueKind.Object) return info;
        if (root.TryGetProperty("oidc_providers", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                info.OidcProviders.Add(new OidcProvider
                {
                    Id = item.TryGetProperty("id", out var id) ? id.GetString() ?? "" : "",
                    Name = item.TryGetProperty("name", out var name) ? name.GetString() ?? "" : "",
                    AuthorizePath = item.TryGetProperty("authorize_path", out var ap) ? ap.GetString() ?? "" : "",
                    AccountUrl = item.TryGetProperty("account_url", out var au) && au.ValueKind == JsonValueKind.String ? au.GetString() : null,
                    ResetPasswordUrl = item.TryGetProperty("reset_password_url", out var rp) && rp.ValueKind == JsonValueKind.String ? rp.GetString() : null,
                });
            }
        }
        return info;
    }

    private async Task ProbeServerInfoAsync()
    {
        if (!IsConfigured) return;
        try
        {
            ServerInfo = await _api.GetServerInfoAsync();
        }
        catch
        {
            ServerInfo = new ServerInfo();
        }
        RaiseInfoChanged();
    }

    private void RaiseChanged()
        => MainThread.BeginInvokeOnMainThread(
            () => ServerChanged?.Invoke(this, EventArgs.Empty));

    private void RaiseInfoChanged()
        => MainThread.BeginInvokeOnMainThread(
            () => ServerInfoChanged?.Invoke(this, EventArgs.Empty));
}
