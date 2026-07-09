using OctoMaui.Models;

namespace OctoMaui.Services;

/// <summary>
/// Manages the user-configurable octo-server endpoint. Because octo-web is an
/// open-source project, the server domain is not known at build time — the
/// user must be able to point the client at whichever instance they want to
/// connect to. The chosen URL is persisted across launches.
/// </summary>
public interface IServerConfigService
{
    /// <summary>
    /// The normalized server origin currently in use (e.g.
    /// <c>https://octo.example.com</c>). Empty string when not yet configured.
    /// </summary>
    string ServerUrl { get; }

    /// <summary>True when a server URL has been saved.</summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Server capability info (OIDC providers etc.) fetched from
    /// <c>/v1/common/appconfig</c>. Null until the server is probed.
    /// </summary>
    ServerInfo? ServerInfo { get; }

    /// <summary>Raised on the UI thread when the server URL changes.</summary>
    event EventHandler? ServerChanged;

    /// <summary>
    /// Raised on the UI thread when <see cref="ServerInfo"/> is (re)loaded.
    /// </summary>
    event EventHandler? ServerInfoChanged;

    /// <summary>
    /// Load the saved URL from preferences into <see cref="ApiOptions"/> /
    /// <see cref="IApiService"/> and probe the server for capabilities. Call
    /// once at startup before any navigation.
    /// </summary>
    Task InitializeAsync();

    /// <summary>
    /// Validate, persist, and apply a new server URL. Returns false if the
    /// server is unreachable. On success, also probes <c>appconfig</c> and
    /// populates <see cref="ServerInfo"/>.
    /// </summary>
    Task<bool> SetServerUrlAsync(string url, CancellationToken ct = default);

    /// <summary>
    /// Test whether <paramref name="url"/> is reachable without saving it.
    /// Returns true if the server responds with any HTTP status.
    /// </summary>
    Task<bool> ValidateAsync(string url, CancellationToken ct = default);

    /// <summary>
    /// Probe a server URL for reachability AND capabilities (OIDC providers
    /// etc.) WITHOUT saving it. Returns null if unreachable. Used by the
    /// server-config page to show a preview before the user commits.
    /// </summary>
    Task<ServerInfo?> ProbeAsync(string url, CancellationToken ct = default);
}
