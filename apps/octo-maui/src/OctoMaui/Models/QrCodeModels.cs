using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>
/// QR code login info returned by <c>GET /v1/user/loginuuid</c>.
/// Mirrors the <c>requestUUID</c> path in <c>login_vm.tsx</c>: the server
/// returns a <c>uuid</c> (used to poll status) and a <c>qrcode</c> string
/// (the URL/content rendered into the QR image).
/// </summary>
public sealed class QrCodeInfo
{
    /// <summary>
    /// Server-issued UUID for this login session. Passed back to
    /// <c>GET /v1/user/loginstatus?uuid=...</c> on each poll.
    /// </summary>
    [JsonPropertyName("uuid")]
    public string Uuid { get; set; } = string.Empty;

    /// <summary>
    /// QR code payload (typically a URL the mobile app scans). The MAUI
    /// client renders this into a QR image via <c>QrCodeGenerator</c> or
    /// equivalent.
    /// </summary>
    [JsonPropertyName("qrcode")]
    public string QrCode { get; set; } = string.Empty;
}

/// <summary>
/// QR login status returned by <c>GET /v1/user/loginstatus?uuid=...</c>.
/// Mirrors <c>pullLoginStatus</c> in <c>login_vm.tsx</c>. The server drives
/// a small state machine through the <see cref="Status"/> field:
/// <list type="bullet">
///   <item><c>waitScan</c> — QR shown, waiting for the user to scan.</item>
///   <item><c>scanned</c> — user scanned, waiting for them to confirm login.</item>
///   <item><c>authed</c> — user authorized; <see cref="AuthCode"/> is populated
///       and the client exchanges it for a session via
///       <c>POST /v1/user/login_authcode/{authCode}</c>.</item>
///   <item><c>expired</c> — the QR code expired; the client should request a
///       new UUID.</item>
/// </list>
/// </summary>
public sealed class QrLoginStatus
{
    /// <summary>One of <c>waitScan</c>, <c>scanned</c>, <c>authed</c>, <c>expired</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;

    /// <summary>
    /// User id of the scanning user (populated in the <c>scanned</c> state).
    /// Used by the web client to show the user's avatar before they confirm.
    /// </summary>
    [JsonPropertyName("uid")]
    public string? Uid { get; set; }

    /// <summary>
    /// One-time auth code exchanged for a session token (populated in the
    /// <c>authed</c> state). The client POSTs it to
    /// <c>/v1/user/login_authcode/{authCode}</c> to complete login.
    /// </summary>
    [JsonPropertyName("auth_code")]
    public string? AuthCode { get; set; }

    [JsonIgnore]
    public bool IsWaitScan => string.Equals(Status, "waitScan", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore]
    public bool IsScanned => string.Equals(Status, "scanned", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore]
    public bool IsAuthed => string.Equals(Status, "authed", StringComparison.OrdinalIgnoreCase);
    [JsonIgnore]
    public bool IsExpired => string.Equals(Status, "expired", StringComparison.OrdinalIgnoreCase);
}
