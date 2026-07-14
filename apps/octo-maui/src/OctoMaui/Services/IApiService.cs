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
    /// Quick reachability + capability check: returns true if the server
    /// responds with a 2xx status to <c>GET /v1/common/appconfig</c>. Only
    /// connection failures or non-2xx responses return false. Because this
    /// hits the real octo-server config endpoint, a true result also implies
    /// the server is an octo-server (not just any HTTP listener).
    /// </summary>
    Task<bool> PingAsync(string url, CancellationToken ct = default);

    /// <summary>Authenticate and obtain a session token.</summary>
    Task<LoginResult> LoginAsync(string username, string password, CancellationToken ct = default);

    /// <summary>
    /// Email + password login (<c>POST /v1/user/emaillogin</c>). Mirrors
    /// <c>requestEmailLogin</c> in <c>login_vm.tsx</c>. MAUI sends
    /// <c>flag=2</c> (PC client).
    /// </summary>
    Task<LoginResult> EmailLoginAsync(string email, string password, CancellationToken ct = default);

    /// <summary>
    /// Username + password registration (<c>POST /v1/user/usernameregister</c>).
    /// Mirrors <c>requestRegister</c> in <c>login_vm.tsx</c>. On success the
    /// server returns a <see cref="LoginResult"/> (auto-login after register).
    /// </summary>
    Task<LoginResult> RegisterAsync(string username, string name, string password, CancellationToken ct = default);

    /// <summary>
    /// Send an email verification code (<c>POST /v1/user/email/sendcode</c>).
    /// Mirrors <c>requestEmailSendCode</c> in <c>login_vm.tsx</c>. The
    /// <paramref name="codeType"/> selects the purpose: <c>0</c> = register,
    /// <c>1</c> = forget password.
    /// </summary>
    Task SendEmailCodeAsync(string email, int codeType, CancellationToken ct = default);

    /// <summary>
    /// Email registration with verification code
    /// (<c>POST /v1/user/emailregister</c>). Mirrors
    /// <c>requestEmailRegister</c> in <c>login_vm.tsx</c>. On success the
    /// server returns a <see cref="LoginResult"/> (auto-login after register).
    /// </summary>
    Task<LoginResult> EmailRegisterAsync(string email, string password, string name, string code, CancellationToken ct = default);

    /// <summary>
    /// Reset password via email verification code
    /// (<c>POST /v1/user/email/forgetpwd</c>). Mirrors
    /// <c>requestForgetPassword</c> in <c>login_vm.tsx</c>. No structured
    /// response body — success is indicated by a 2xx status code.
    /// </summary>
    Task ForgetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default);

    // --- QR code login (state machine driven, see login_vm.tsx advance) ---

    /// <summary>
    /// Request a QR code login session (<c>GET /v1/user/loginuuid</c>).
    /// Mirrors <c>requestUUID</c> in <c>login_vm.tsx</c>. The device info is
    /// sent as query parameters (matching the web client's
    /// <c>{ param: device }</c> form).
    /// </summary>
    Task<QrCodeInfo> GetQrCodeAsync(CancellationToken ct = default);

    /// <summary>
    /// Poll the QR login status (<c>GET /v1/user/loginstatus?uuid=...</c>).
    /// Mirrors <c>pullLoginStatus</c> in <c>login_vm.tsx</c>. The returned
    /// <see cref="QrLoginStatus.Status"/> drives the state machine:
    /// <c>waitScan</c> → <c>scanned</c> → <c>authed</c> (or <c>expired</c>).
    /// </summary>
    Task<QrLoginStatus> PollQrLoginStatusAsync(string uuid, CancellationToken ct = default);

    /// <summary>
    /// Exchange a QR-login auth code for a session
    /// (<c>POST /v1/user/login_authcode/{authCode}</c>). Mirrors
    /// <c>requestLogin</c> in <c>login_vm.tsx</c>. Called once the QR status
    /// reaches <c>authed</c> and <see cref="QrLoginStatus.AuthCode"/> is
    /// populated.
    /// </summary>
    Task<LoginResult> LoginWithAuthCodeAsync(string authCode, CancellationToken ct = default);

    /// <summary>Fetch the authenticated user's profile.</summary>
    Task<User> GetCurrentUserAsync(string token, CancellationToken ct = default);

    /// <summary>List the user's channels.</summary>
    Task<List<Channel>> GetChannelsAsync(string token, CancellationToken ct = default);

    /// <summary>Load message history for a channel (newest last).</summary>
    Task<List<Message>> GetMessagesAsync(string token, string channelId, int limit = 50, long? beforeTimestamp = null, CancellationToken ct = default);

    /// <summary>Send a text message to a channel.</summary>
    Task<Message> SendMessageAsync(string token, string channelId, string content, CancellationToken ct = default);

    /// <summary>
    /// Upload a file/image to a channel via two-step presigned direct upload
    /// (matches packages/dmworkbase/src/Service/UploadCredentials.ts):
    /// 1. <c>GET /v1/file/upload/credentials</c> → <c>{ uploadUrl, downloadUrl, ... }</c>
    /// 2. <c>PUT</c> raw body to <c>uploadUrl</c> → returns <c>downloadUrl</c>.
    /// The <paramref name="channelType"/> + <paramref name="channelId"/> form
    /// the storage path <c>/{channelType}/{channelId}/{uuid}.{ext}</c>.
    /// </summary>
    Task<string> UploadFileAsync(string token, string channelId, ChannelType channelType, Stream fileStream, string fileName, string contentType, CancellationToken ct = default);

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
    /// <c>authcode</c>, <c>return_to</c>, and <c>flag</c> query parameters.
    /// Handles both absolute and server-relative
    /// <see cref="OidcProvider.AuthorizePath"/>. The <paramref name="returnTo"/>
    /// parameter defaults to <c>"/login"</c> but can be overridden for
    /// alternative passport/OAuth deployments.
    /// </summary>
    string BuildAuthorizeUrl(OidcProvider provider, string authCode, string returnTo = "/login");
}
