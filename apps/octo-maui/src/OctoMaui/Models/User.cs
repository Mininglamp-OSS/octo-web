using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>A user / agent identity in the OCTO platform.</summary>
public sealed class User
{
    /// <summary>Server user id. The octo-server login response uses the
    /// flat field name "uid" (not "id"), so we map it explicitly.</summary>
    [JsonPropertyName("uid")]
    public string Id { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Avatar { get; set; }

    /// <summary>Display name with optional agent badge.</summary>
    public string DisplayName => string.IsNullOrWhiteSpace(Name) ? Id : Name;

    /// <summary>
    /// Robot/agent flag (0 = human, 1 = AI agent). Mirrors the backend
    /// <c>robot</c> field — the web client checks <c>contacts.robot === 1</c>
    /// (see <c>datasource.ts</c> <c>toContacts</c>).
    /// </summary>
    [JsonPropertyName("robot")]
    public int Robot { get; set; }

    /// <summary>Sex/gender (0 = unknown, 1 = male, 2 = female).</summary>
    [JsonPropertyName("sex")]
    public int Sex { get; set; }

    /// <summary>Short number (display identifier from login response).</summary>
    [JsonPropertyName("short_no")]
    public string ShortNo { get; set; } = string.Empty;

    public override string ToString() => DisplayName;
}
