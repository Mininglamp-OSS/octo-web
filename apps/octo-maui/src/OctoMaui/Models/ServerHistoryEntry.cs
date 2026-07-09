namespace OctoMaui.Models;

/// <summary>
/// A previously-connected server URL, persisted so the user can quickly
/// re-connect without retyping the address.
/// </summary>
public sealed class ServerHistoryEntry
{
    /// <summary>Normalized server origin, e.g. <c>https://octo.example.com</c>.</summary>
    public string Url { get; set; } = string.Empty;

    /// <summary>Unix-millisecond timestamp of the last successful connection.</summary>
    public long LastUsedMs { get; set; }

    /// <summary>Human-readable relative time, computed for display.</summary>
    public string LastUsedText =>
        DateTimeOffset.FromUnixTimeMilliseconds(LastUsedMs).ToLocalTime() is { } t
            ? t.Date == DateTimeOffset.Now.Date
                ? $"今天 {t:HH:mm}"
                : t.Date == DateTimeOffset.Now.Date.AddDays(-1)
                    ? $"昨天 {t:HH:mm}"
                    : t.ToString("MM-dd HH:mm")
            : "";
}
