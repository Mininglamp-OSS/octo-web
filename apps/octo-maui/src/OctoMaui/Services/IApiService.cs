using OctoMaui.Models;

namespace OctoMaui.Services;

public interface IApiService
{
    /// <summary>Current REST base URL the client is pointing at.</summary>
    string BaseUrl { get; }

    /// <summary>
    /// Switch the REST endpoint at runtime. Recreates the internal
    /// <see cref="HttpClient"/> with the new base address. Call this when the
    /// user changes the server domain via <see cref="IServerConfigService"/>.
    /// </summary>
    void UpdateBaseUrl(string url);

    /// <summary>
    /// Quick reachability check: returns true if the server responds with any
    /// HTTP status (even 401/404). Only connection failures return false.
    /// </summary>
    Task<bool> PingAsync(string url, CancellationToken ct = default);

    /// <summary>Authenticate and obtain a session token.</summary>
    Task<LoginResult> LoginAsync(string username, string password, CancellationToken ct = default);

    /// <summary>Fetch the authenticated user's profile.</summary>
    Task<User> GetCurrentUserAsync(string token, CancellationToken ct = default);

    /// <summary>List the user's channels.</summary>
    Task<List<Channel>> GetChannelsAsync(string token, CancellationToken ct = default);

    /// <summary>Load message history for a channel (newest last).</summary>
    Task<List<Message>> GetMessagesAsync(string token, string channelId, int limit = 50, long? beforeTimestamp = null, CancellationToken ct = default);

    /// <summary>Send a text message to a channel.</summary>
    Task<Message> SendMessageAsync(string token, string channelId, string content, CancellationToken ct = default);

    /// <summary>Upload a file/image to a channel via multipart/form-data.</summary>
    Task<Message> UploadFileAsync(string token, string channelId, Stream fileStream, string fileName, string contentType, CancellationToken ct = default);

    // --- OIDC / enterprise passport (SSO) ---

    /// <summary>
    /// Fetch the server's capability/config endpoint
    /// (<c>GET /v1/common/appconfig</c>) to discover OIDC providers and other
    /// runtime settings. Returns an empty <see cref="ServerInfo"/> (no
    /// providers) if the endpoint is unavailable — callers fall back to local
    /// login.
    /// </summary>
    Task<ServerInfo> GetServerInfoAsync(CancellationToken ct = default);

    /// <summary>
    /// Request a one-time authcode for third-party login
    /// (<c>GET /v1/user/thirdlogin/authcode</c>). The code is embedded in the
    /// authorize URL the user opens in a browser, and is later polled via
    /// <see cref="PollAuthStatusAsync"/>.
    /// </summary>
    Task<string> GetAuthCodeAsync(CancellationToken ct = default);

    /// <summary>
    /// Poll the login status for a previously issued authcode
    /// (<c>GET /v1/user/thirdlogin/authstatus?authcode=...</c>).
    /// </summary>
    Task<OidcAuthStatus> PollAuthStatusAsync(string authCode, CancellationToken ct = default);

    /// <summary>
    /// Build the full authorize URL for a given OIDC provider, appending the
    /// <c>authcode</c> and <c>flag=1</c> query parameters. Handles both
    /// absolute and server-relative <see cref="OidcProvider.AuthorizePath"/>.
    /// </summary>
    string BuildAuthorizeUrl(OidcProvider provider, string authCode);
}
