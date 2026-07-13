using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>
/// Describes the authentication capabilities of the connected octo-server,
/// obtained from <c>GET /v1/common/appconfig</c>. Drives whether the login
/// page shows OIDC/SSO buttons alongside (or instead of) the local
/// username/password form.
/// </summary>
public sealed class ServerInfo
{
    /// <summary>OIDC / SSO providers configured on the server. Empty when the
    /// server only supports its built-in user system.</summary>
    [JsonPropertyName("oidc_providers")]
    public List<OidcProvider> OidcProviders { get; set; } = new();

    /// <summary>
    /// True when the server has disabled legacy username/password login
    /// (backend <c>legacy_password_login_off</c> field in appconfig). When
    /// true, the login page should only show OIDC/SSO buttons.
    /// </summary>
    [JsonPropertyName("legacy_password_login_off")]
    public bool LegacyPasswordLoginOff { get; set; }

    /// <summary>True when at least one OIDC provider is available.</summary>
    [JsonIgnore]
    public bool HasOidcProviders => OidcProviders is { Count: > 0 };
}

/// <summary>
/// A single SSO / OIDC identity provider, as advertised by the server's
/// <c>appconfig</c> endpoint. Mirrors <c>packages/dmworklogin/src/oidc</c>.
/// </summary>
public sealed class OidcProvider
{
    /// <summary>Provider identifier, e.g. <c>"aegis"</c>.</summary>
    public string Id { get; set; } = string.Empty;

    /// <summary>Display name shown on the login button, e.g. "企业统一身份".</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>
    /// Full authorize URL (absolute) or a server-relative path. The client
    /// appends <c>?authcode=...&amp;return_to=...&amp;flag=2</c> and opens it
    /// in the system browser.
    /// </summary>
    [JsonPropertyName("authorize_path")]
    public string AuthorizePath { get; set; } = string.Empty;

    /// <summary>Optional account-management URL (profile page on the IdP).</summary>
    [JsonPropertyName("account_url")]
    public string? AccountUrl { get; set; }

    /// <summary>Optional password-reset URL on the IdP.</summary>
    [JsonPropertyName("reset_password_url")]
    public string? ResetPasswordUrl { get; set; }
}

/// <summary>
/// Result of polling <c>GET /v1/user/thirdlogin/authstatus?authcode=...</c>.
/// </summary>
public sealed class OidcAuthStatus
{
    /// <summary>0 = pending, 1 = success, 2 = failure.</summary>
    public int Status { get; set; }

    /// <summary>Populated when <see cref="Status"/> == 1.</summary>
    public OidcAuthResult? Result { get; set; }

    /// <summary>Error message when <see cref="Status"/> == 2.</summary>
    public string? Msg { get; set; }

    [JsonIgnore]
    public bool IsPending => Status == 0;
    [JsonIgnore]
    public bool IsSuccess => Status == 1;
    [JsonIgnore]
    public bool IsFailure => Status == 2;
}

/// <summary>Successful OIDC login payload.</summary>
public sealed class OidcAuthResult
{
    public string Uid { get; set; } = string.Empty;
    public string Token { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;

    /// <summary>Short number (mirrors <c>short_no</c> from password login).</summary>
    [JsonPropertyName("short_no")]
    public string? ShortNo { get; set; }

    /// <summary>Sex/gender (mirrors <c>sex</c> from password login).</summary>
    [JsonPropertyName("sex")]
    public int Sex { get; set; }
}
