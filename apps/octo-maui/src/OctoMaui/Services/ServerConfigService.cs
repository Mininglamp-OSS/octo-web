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
    private const string PrefKey = PreferencesKeys.ServerUrl;

    private readonly ApiOptions _options;
    private readonly IApiService _api;
    private readonly IAuthService _auth;

    public ServerConfigService(ApiOptions options, IApiService api, IAuthService auth)
    {
        _options = options;
        _api = api;
        _auth = auth;
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
        try { Preferences.Default.Set(PrefKey, normalized); }
        catch { /* ignore preference save errors */ }

        await _auth.LogoutAsync();

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
            using var resp = await probe.GetAsync(ApiPaths.CommonAppconfig, ct);
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
        return HttpUtils.CreateHttpClient(baseUrl, timeout, _options.AllowInsecureSsl);
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

        // legacy_password_login_off: when true, the server has disabled
        // username/password login (mirrors ApiService.GetServerInfoAsync).
        if (root.TryGetProperty("legacy_password_login_off", out var lplo) && lplo.ValueKind == JsonValueKind.True)
        {
            info.LegacyPasswordLoginOff = true;
        }

        if (root.TryGetProperty("oidc_providers", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                // id and name must be non-empty strings — skip otherwise.
                var id = item.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String
                    ? idEl.GetString() ?? "" : "";
                var name = item.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String
                    ? nameEl.GetString() ?? "" : "";
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)) continue;

                // authorize_path must be a safe in-site relative path (starts
                // with /, not //) — mirrors IsSafeAuthorizePath in ApiService.
                var authorizePath = item.TryGetProperty("authorize_path", out var apEl) && apEl.ValueKind == JsonValueKind.String
                    ? apEl.GetString() ?? "" : "";
                if (!ApiService.IsSafeAuthorizePath(authorizePath)) continue;

                info.OidcProviders.Add(new OidcProvider
                {
                    Id = id,
                    Name = name,
                    AuthorizePath = authorizePath,
                    // account_url / reset_password_url must be http/https —
                    // mirrors SanitizeHttpUrl in ApiService.
                    AccountUrl = ApiService.SanitizeHttpUrl(item, "account_url"),
                    ResetPasswordUrl = ApiService.SanitizeHttpUrl(item, "reset_password_url"),
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
