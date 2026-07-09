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

        // Step 1: reachability check (5s timeout via PingAsync).
        if (!await _api.PingAsync(normalized, ct))
            return null;

        // Step 2: temporarily point the ApiService at the candidate URL so
        // GetServerInfoAsync hits the right server, then restore the previous
        // URL so the service state is unchanged if the user cancels.
        var previousUrl = _options.BaseUrl;
        try
        {
            _api.UpdateBaseUrl(normalized);
            _options.BaseUrl = normalized;
            return await _api.GetServerInfoAsync(ct);
        }
        catch
        {
            return new ServerInfo();
        }
        finally
        {
            // Restore — never persist the probed URL here.
            try
            {
                _api.UpdateBaseUrl(previousUrl);
                _options.BaseUrl = previousUrl;
            }
            catch
            {
                // If the previous URL was empty/invalid, leave the api pointed
                // at the candidate so subsequent SetServerUrlAsync works.
            }
        }
    }

    // --- helpers ---

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
