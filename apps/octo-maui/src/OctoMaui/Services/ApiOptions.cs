namespace OctoMaui.Services;

/// <summary>
/// Configuration for the octo-server REST + WebSocket endpoints.
/// </summary>
public sealed class ApiOptions
{
    /// <summary>Base URL of the octo-server REST API, e.g. http://localhost:8080.</summary>
    public string BaseUrl { get; set; } = "http://localhost:8080";

    /// <summary>WebSocket URL derived from BaseUrl (http→ws / https→wss).</summary>
    public string WebSocketUrl
    {
        get
        {
            var baseUri = new Uri(BaseUrl);
            var scheme = baseUri.Scheme == "https" ? "wss" : "ws";
            var builder = new UriBuilder(scheme, baseUri.Host, baseUri.Port)
            {
                Path = "/ws"
            };
            return builder.Uri.ToString();
        }
    }

    /// <summary>Request timeout for REST calls.</summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(15);

    /// <summary>Allow self-signed certificates for internal deployments. Default false.</summary>
    public bool AllowInsecureSsl { get; set; } = false;
}
