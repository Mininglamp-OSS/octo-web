using System.Net;
using System.Net.Http;

namespace OctoMaui.Services;

internal static class HttpUtils
{
    public static bool IsLoopback(string host)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase))
            return true;
        if (IPAddress.TryParse(host, out var ip))
            return IPAddress.IsLoopback(ip);
        return false;
    }

    public static HttpClient CreateHttpClient(string baseUrl, TimeSpan timeout, bool allowInsecureSsl)
    {
        var handler = new HttpClientHandler();
        if (allowInsecureSsl)
        {
            handler.ServerCertificateCustomValidationCallback = (message, cert, chain, errors) =>
            {
                if (message.RequestUri is { } uri && IsLoopback(uri.Host))
                    return true;
                return errors == SslPolicyErrors.None;
            };
        }
        return new HttpClient(handler) { BaseAddress = new Uri(baseUrl), Timeout = timeout };
    }
}