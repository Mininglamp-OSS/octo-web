using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>
/// A conversation channel (person, group, or community topic).
///
/// In the WuKongIM architecture <c>Channel</c> (channelID + channelType)
/// and <c>ChannelInfo</c> (title, logo, orgData …) are separate objects —
/// see packages/dmworkdatasource/src/module.ts channelInfoCallback.
/// The MAUI client merges them into this single model for UI binding until
/// the WuKongIM .NET client is integrated.
/// </summary>
public sealed class Channel
{
    /// <summary>Channel id (WuKongIM: channelID).</summary>
    [JsonPropertyName("channelID")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Display name (corresponds to WuKongIM ChannelInfo.title).</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Avatar URL (corresponds to WuKongIM ChannelInfo.logo).</summary>
    public string? Avatar { get; set; }

    /// <summary>person | group | communityTopic (WuKongIM: channelType).</summary>
    [JsonPropertyName("channelType")]
    public ChannelType Type { get; set; } = ChannelType.Person;

    /// <summary>Last read message id (for unread badge calc).</summary>
    [JsonPropertyName("last_read_message_id")]
    public string? LastReadMessageId { get; set; }

    /// <summary>Unread count, filled by client.</summary>
    [JsonIgnore]
    public int UnreadCount { get; set; }

    /// <summary>Preview of the most recent message, filled by client.</summary>
    [JsonIgnore]
    public string LastMessagePreview { get; set; } = string.Empty;

    /// <summary>Timestamp of the most recent message, filled by client.</summary>
    [JsonIgnore]
    public long LastMessageTimestampMs { get; set; }

    public override string ToString() => Name;
}

/// <summary>
/// Channel types. Values mirror WuKongIM:
/// ChannelTypePerson = 1, ChannelTypeGroup = 2 (from wukongimjssdk);
/// ChannelTypeCommunityTopic = 5 (packages/dmworkbase/src/Service/Const.ts).
/// ChannelTypeCustomerService = 3 exists in WuKongIM but is not needed by
/// the MAUI client at this time.
/// </summary>
public enum ChannelType
{
    Person = 1,
    Group = 2,
    CommunityTopic = 5,
}
