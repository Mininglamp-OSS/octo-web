using OctoMaui.Models;

namespace OctoMaui.Services;

public interface IAuthService
{
    bool IsAuthenticated { get; }
    string? Token { get; }
    User? CurrentUser { get; }

    /// <summary>Raised on the UI thread whenever login/logout happens.</summary>
    event EventHandler AuthStateChanged;

    /// <summary>
    /// Load the saved token from SecureStorage. Must be called once during
    /// app startup before any auth-state check.
    /// </summary>
    Task InitializeAsync();

    /// <summary>Local username/password login (octo-server built-in user system).</summary>
    Task<bool> LoginAsync(string username, string password, CancellationToken ct = default);

    /// <summary>
    /// Email + password login. Mirrors <c>requestEmailLogin</c> in
    /// <c>login_vm.tsx</c>. On success the session is persisted (token to
    /// SecureStorage, profile to Preferences) and
    /// <see cref="AuthStateChanged"/> is raised.
    /// </summary>
    Task<bool> EmailLoginAsync(string email, string password, CancellationToken ct = default);

    /// <summary>
    /// Username + password registration. Mirrors <c>requestRegister</c> in
    /// <c>login_vm.tsx</c>. On success the server returns a session
    /// (auto-login after register) which is persisted like a normal login.
    /// </summary>
    Task<bool> RegisterAsync(string username, string name, string password, CancellationToken ct = default);

    /// <summary>
    /// Send an email verification code. Mirrors <c>requestEmailSendCode</c>
    /// in <c>login_vm.tsx</c>. <paramref name="codeType"/>: <c>0</c> = register,
    /// <c>1</c> = forget password. Returns true on success; the caller is
    /// responsible for starting any UI countdown.
    /// </summary>
    Task<bool> SendEmailCodeAsync(string email, int codeType, CancellationToken ct = default);

    /// <summary>
    /// Email registration with verification code. Mirrors
    /// <c>requestEmailRegister</c> in <c>login_vm.tsx</c>. On success the
    /// server returns a session (auto-login after register) which is
    /// persisted like a normal login.
    /// </summary>
    Task<bool> EmailRegisterAsync(string email, string password, string name, string code, CancellationToken ct = default);

    /// <summary>
    /// Reset password via email verification code. Mirrors
    /// <c>requestForgetPassword</c> in <c>login_vm.tsx</c>. Returns true on
    /// success; the caller should clear sensitive fields and switch back to
    /// the login view.
    /// </summary>
    Task<bool> ForgetPasswordAsync(string email, string code, string newPassword, CancellationToken ct = default);

    /// <summary>
    /// Exchange a QR-login auth code for a session. Mirrors
    /// <c>requestLogin</c> in <c>login_vm.tsx</c>. Called once the QR status
    /// reaches <c>authed</c>. On success the session is persisted like a
    /// normal login.
    /// </summary>
    Task<bool> LoginWithAuthCodeAsync(string authCode, CancellationToken ct = default);

    /// <summary>
    /// Enterprise passport / OIDC SSO login. Obtains an authcode, opens the
    /// IdP authorize URL in the system browser, and polls the server for
    /// completion. <paramref name="progress"/> receives status messages for
    /// UI feedback. Returns true on successful authentication.
    /// </summary>
    Task<bool> LoginWithOidcAsync(OidcProvider provider, IProgress<string>? progress = null, CancellationToken ct = default);

    Task LogoutAsync();

    /// <summary>
    /// Hydrate CurrentUser after a cold start when a saved token exists.
    /// Returns false (and forces logout) if the token is invalid.
    /// </summary>
    Task<bool> HydrateCurrentUserAsync(CancellationToken ct = default);
}
