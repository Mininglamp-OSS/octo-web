using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace OctoMaui.Models;

/// <summary>
/// A single chat message in a channel.
///
/// Field names and JSON mappings follow the WuKongIM SDK Message type
/// (packages/dmworkbase/src/Service/Model.tsx — MessageWrap / Message).
/// Until the WuKongIM .NET client is integrated, messages arrive via REST
/// endpoints; the mappings below are ready for the SDK switch-over.
/// </summary>
public sealed class Message : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    private string _id = string.Empty;
    private string _content = string.Empty;
    private bool _isStreaming;
    private string? _createdAtFormattedCache;
    private long _cachedTimestampMs = -1;

    /// <summary>Server-assigned message id (WuKongIM: messageID).</summary>
    [JsonPropertyName("messageID")]
    public string Id { get => _id; set => SetField(ref _id, value); }

    /// <summary>Channel this message belongs to.</summary>
    [JsonPropertyName("channel_id")]
    public string ChannelId { get; set; } = string.Empty;

    /// <summary>Sender user id (WuKongIM: fromUID).</summary>
    [JsonPropertyName("fromUID")]
    public string FromUid { get; set; } = string.Empty;

    /// <summary>Cached sender display name (filled by client for rendering).</summary>
    public string SenderName { get; set; } = string.Empty;

    /// <summary>
    /// Plain-text or markdown body. In WuKongIM this is the <c>content</c>
    /// object (MessageText etc.); the MAUI client stores it as a plain string
    /// for simplicity — full content-object decoding is deferred until the
    /// WuKongIM .NET client is integrated.
    /// </summary>
    public string Content
    {
        get => _content;
        set => SetField(ref _content, value);
    }

    /// <summary>Message content type (WuKongIM: contentType, numeric).</summary>
    [JsonPropertyName("contentType")]
    public MessageType Type { get; set; } = MessageType.Text;

    /// <summary>Server timestamp in milliseconds since epoch.</summary>
    [JsonPropertyName("timestamp")]
    public long TimestampMs { get; set; }

    // --- attachment fields (for image / file messages) ---

    /// <summary>Remote URL for image/file attachments.</summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>Original file name for attachments.</summary>
    [JsonPropertyName("file_name")]
    public string? FileName { get; set; }

    /// <summary>File size in bytes (for display).</summary>
    [JsonPropertyName("file_size")]
    public long FileSize { get; set; }

    /// <summary>True if this message has an image attachment.</summary>
    [JsonIgnore]
    public bool HasImage => Type == MessageType.Image && !string.IsNullOrWhiteSpace(Url);

    /// <summary>
    /// Validated image URL: only http/https absolute URLs are accepted.
    /// Null if Url is missing, unsafe, or a relative URL.
    /// </summary>
    [JsonIgnore]
    public string? SafeImageUrl
    {
        get
        {
            if (!HasImage || string.IsNullOrWhiteSpace(Url))
                return null;
            if (!Uri.TryCreate(Url, UriKind.Absolute, out var uri))
                return null;
            // Only allow http/https schemes — block file://, javascript:, data:, etc.
            if (uri.Scheme != "http" && uri.Scheme != "https")
                return null;
            return Url;
        }
    }

    /// <summary>True if this message has a file attachment.</summary>
    [JsonIgnore]
    public bool HasFile => Type == MessageType.File && !string.IsNullOrWhiteSpace(FileName);

    /// <summary>Human-readable file size (e.g. "1.2 MB").</summary>
    [JsonIgnore]
    public string FileSizeText => FileSize switch
    {
        0 => "",
        < 1024 => $"{FileSize} B",
        < 1024 * 1024 => $"{FileSize / 1024.0:F1} KB",
        < 1024 * 1024 * 1024 => $"{FileSize / (1024.0 * 1024):F1} MB",
        _ => $"{FileSize / (1024.0 * 1024 * 1024):F2} GB",
    };

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
            // Invalidate cache when TimestampMs changes.
            if (_cachedTimestampMs != TimestampMs)
            {
                _cachedTimestampMs = TimestampMs;
                _createdAtFormattedCache = null;
            }
            if (_createdAtFormattedCache is null)
            {
                var now = DateTimeOffset.Now;
                var local = CreatedAt.ToLocalTime();
                _createdAtFormattedCache = local.Date switch
                {
                    var d when d == now.Date => local.ToString("HH:mm"),
                    var d when d == now.Date.AddDays(-1) => $"昨天 {local:HH:mm}",
                    var d when local.Year == now.Year => local.ToString("MM-dd HH:mm"),
                    _ => local.ToString("yyyy-MM-dd HH:mm"),
                };
            }
            return _createdAtFormattedCache;
        }
    }

    /// <summary>
    /// True if this message is part of an AI streaming response
    /// (WuKongIM: streamOn).
    /// </summary>
    [JsonPropertyName("streamOn")]
    public bool IsStreaming
    {
        get => _isStreaming;
        set => SetField(ref _isStreaming, value);
    }

    /// <summary>
    /// Stream progress flag (WuKongIM: streamFlag). Stored as int because the
    /// MAUI client does not yet bundle the WuKongIM SDK StreamFlag enum.
    /// Typical values: 0 = START, 1 = ING, 2 = END.
    /// </summary>
    [JsonPropertyName("streamFlag")]
    public int StreamFlag { get; set; }

    // --- INotifyPropertyChanged helpers ---

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
    }
}

/// <summary>
/// Message content types. Values mirror WuKongIM MessageContentTypeConst
/// (packages/dmworkbase/src/Service/Const.ts). Only types relevant to the
/// MAUI client are listed here.
/// </summary>
public enum MessageType
{
    Text = 1,
    Image = 2,
    Gif = 3,
    Voice = 4,
    SmallVideo = 5,
    File = 8,
    RichText = 14,
}
