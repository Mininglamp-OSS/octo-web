using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>A single chat message in a channel.</summary>
public sealed class Message
{
    public string Id { get; set; } = string.Empty;

    /// <summary>Channel this message belongs to.</summary>
    [JsonPropertyName("channel_id")]
    public string ChannelId { get; set; } = string.Empty;

    /// <summary>Sender user id.</summary>
    [JsonPropertyName("from_uid")]
    public string FromUid { get; set; } = string.Empty;

    /// <summary>Cached sender display name (filled by client for rendering).</summary>
    public string SenderName { get; set; } = string.Empty;

    /// <summary>Plain-text or markdown body.</summary>
    public string Content { get; set; } = string.Empty;

    /// <summary>Message type: text / image / file / system / tool_call.</summary>
    [JsonPropertyName("message_type")]
    public MessageType Type { get; set; } = MessageType.Text;

    /// <summary>Server timestamp in milliseconds since epoch.</summary>
    [JsonPropertyName("timestamp")]
    public long TimestampMs { get; set; }

    [JsonIgnore]
    public DateTimeOffset CreatedAt =>
        DateTimeOffset.FromUnixTimeMilliseconds(TimestampMs);

    /// <summary>
    /// Friendly localized timestamp: "HH:mm" for today, "昨天 HH:mm" for
    /// yesterday, "MM-dd HH:mm" for this year, "yyyy-MM-dd HH:mm" otherwise.
    /// </summary>
    [JsonIgnore]
    public string CreatedAtFormatted
    {
        get
        {
            var now = DateTimeOffset.Now;
            var local = CreatedAt.ToLocalTime();
            if (local.Date == now.Date)
                return local.ToString("HH:mm");
            if (local.Date == now.Date.AddDays(-1))
                return $"昨天 {local:HH:mm}";
            if (local.Year == now.Year)
                return local.ToString("MM-dd HH:mm");
            return local.ToString("yyyy-MM-dd HH:mm");
        }
    }

    /// <summary>True if streamed from an AI agent (partial / typing).</summary>
    [JsonPropertyName("streaming")]
    public bool IsStreaming { get; set; }
}

public enum MessageType
{
    Text = 1,
    Image = 2,
    File = 3,
    System = 4,
    ToolCall = 5,
}
