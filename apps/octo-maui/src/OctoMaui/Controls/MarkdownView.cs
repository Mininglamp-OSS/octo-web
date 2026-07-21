using Microsoft.Maui.Controls.Shapes;
using System.Text.RegularExpressions;

namespace OctoMaui.Controls;

/// <summary>
/// Lightweight markdown renderer for chat messages. Parses common markdown
/// syntax (code blocks, headers, bold, inline code, lists) and renders them
/// as native MAUI elements. Avoids WebView for performance.
/// </summary>
public sealed class MarkdownView : VerticalStackLayout
{
    private string _markdown = string.Empty;

    /// <summary>
    /// Platform-appropriate monospace font family for code rendering.
    /// Cascadia Code is Windows-only; other platforms use their native
    /// monospace fallback (Menlo on Apple, monospace on Android).
    /// </summary>
    private static string MonospaceFont =>
        DeviceInfo.Platform == DevicePlatform.WinUI ? "Cascadia Code" : "Menlo";

    /// <summary>
    /// Combined pattern for inline bold (**text**) and inline code (`code`).
    /// Compiled once and reused across renders for performance.
    /// </summary>
    private static readonly Regex InlineFormatRegex = new(@"(\*\*[^*]+\*\*|`[^`]+`)", RegexOptions.Compiled);

    /// <summary>The markdown source text to render.</summary>
    public static readonly BindableProperty MarkdownProperty =
        BindableProperty.Create(nameof(Markdown), typeof(string), typeof(MarkdownView),
            default(string), propertyChanged: OnMarkdownChanged);

    public string Markdown
    {
        get => (string)GetValue(MarkdownProperty);
        set => SetValue(MarkdownProperty, value);
    }

    public MarkdownView()
    {
        Spacing = 4;
        Padding = new Thickness(0);
    }

    private static void OnMarkdownChanged(BindableObject bindable, object oldValue, object newValue)
    {
        if (bindable is MarkdownView view)
            view.Render((string)newValue);
    }

    protected override void OnParentSet()
    {
        base.OnParentSet();
        if (Parent is not null)
        {
            if (Application.Current is not null)
                Application.Current.RequestedThemeChanged += OnThemeChanged;
        }
        else
        {
            if (Application.Current is not null)
                Application.Current.RequestedThemeChanged -= OnThemeChanged;
        }
    }

    private void OnThemeChanged(object? sender, AppThemeChangedEventArgs e)
    {
        // Re-render with new theme colors.
        Render();
    }

    private void Render() => Render(Markdown);

    private void Render(string markdown)
    {
        Children.Clear();
        if (string.IsNullOrEmpty(markdown)) return;

        var lines = markdown.Split('\n');
        var i = 0;
        while (i < lines.Length)
        {
            var line = lines[i].TrimEnd('\r');

            // Code block: ``` ... ```
            if (line.StartsWith("```"))
            {
                var lang = line.Substring(3).Trim();
                var sb = new System.Text.StringBuilder();
                i++;
                while (i < lines.Length && !lines[i].TrimStart().StartsWith("```"))
                {
                    sb.AppendLine(lines[i].TrimEnd('\r'));
                    i++;
                }
                if (i >= lines.Length)
                {
                    // Unterminated code block — include remaining lines as code content.
                    Children.Add(CreateCodeBlock(sb.ToString()));
                    break;
                }
                i++; // skip closing ```
                Children.Add(CreateCodeBlock(sb.ToString()));
                continue;
            }

            // Headers: # / ## / ###
            if (line.StartsWith("### "))
            {
                Children.Add(CreateHeader(line.Substring(4), 14));
                i++;
                continue;
            }
            if (line.StartsWith("## "))
            {
                Children.Add(CreateHeader(line.Substring(3), 16));
                i++;
                continue;
            }
            if (line.StartsWith("# "))
            {
                Children.Add(CreateHeader(line.Substring(2), 18));
                i++;
                continue;
            }

            // List items: - or * or 1.
            if (Regex.IsMatch(line, @"^[-*]\s+") || Regex.IsMatch(line, @"^\d+\.\s+"))
            {
                var bullet = "• ";
                var match = Regex.Match(line, @"^[-*]\s+(.*)");
                if (match.Success)
                {
                    Children.Add(CreateParagraph(bullet + match.Groups[1].Value));
                }
                else
                {
                    match = Regex.Match(line, @"^\d+\.\s+(.*)");
                    if (match.Success)
                        Children.Add(CreateParagraph(match.Groups[0].Value));
                }
                i++;
                continue;
            }

            // Empty line — skip
            if (string.IsNullOrWhiteSpace(line))
            {
                i++;
                continue;
            }

            // Regular paragraph
            Children.Add(CreateParagraph(line));
            i++;
        }
    }

    private static Label CreateHeader(string text, double fontSize)
    {
        return new Label
        {
            FormattedText = ParseInline(text),
            FontSize = fontSize,
            FontAttributes = FontAttributes.Bold,
            TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb(MarkdownColors.Dark.Header)
                : Color.FromArgb(MarkdownColors.Light.Header),
            Margin = new Thickness(0, 4, 0, 2),
        };
    }

    private static Label CreateParagraph(string text)
    {
        return new Label
        {
            FormattedText = ParseInline(text),
            FontSize = 14,
            TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
                ? Color.FromArgb(MarkdownColors.Dark.Text)
                : Color.FromArgb(MarkdownColors.Light.Text),
        };
    }

    private static Border CreateCodeBlock(string code)
    {
        var label = new Label
        {
            Text = code.TrimEnd(),
            FontFamily = MonospaceFont,
            FontSize = 13,
            TextColor = Color.FromArgb("#E0E0E0"),
        };

        return new Border
        {
            BackgroundColor = Color.FromArgb("#1E1E1E"),
            Stroke = Color.FromArgb("#333333"),
            StrokeThickness = 1,
            StrokeShape = new RoundRectangle { CornerRadius = 6 },
            Padding = new Thickness(12, 8),
            Content = label,
            Margin = new Thickness(0, 2),
        };
    }

    /// <summary>
    /// Parse inline markdown (bold **text**, inline code `code`) into a
    /// FormattedString with appropriate spans.
    /// </summary>
    private static FormattedString ParseInline(string text)
    {
        // NOTE: The current regex patterns do not support nested inline formatting
        // (e.g., **bold *italic* bold**). This is a known limitation; for full
        // markdown compliance, consider a proper parser like Markdig.

        var fs = new FormattedString();

        // Pattern: matches **bold**, `code`, or plain text segments.
        var pos = 0;
        foreach (Match m in InlineFormatRegex.Matches(text))
        {
            // Plain text before this match
            if (m.Index > pos)
            {
                fs.Spans.Add(new Span
                {
                    Text = text.Substring(pos, m.Index - pos),
                    TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
                        ? Color.FromArgb(MarkdownColors.Dark.Text)
                        : Color.FromArgb(MarkdownColors.Light.Text),
                });
            }

            var token = m.Value;
            if (token.StartsWith("**"))
            {
                fs.Spans.Add(new Span
                {
                    Text = token.Substring(2, token.Length - 4),
                    FontAttributes = FontAttributes.Bold,
                    TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
                        ? Color.FromArgb(MarkdownColors.Dark.Strong)
                        : Color.FromArgb(MarkdownColors.Light.Strong),
                });
            }
            else if (token.StartsWith("`"))
            {
                fs.Spans.Add(new Span
                {
                    Text = token.Substring(1, token.Length - 2),
                    FontFamily = MonospaceFont,
                    TextColor = Color.FromArgb(MarkdownColors.Light.CodeText),
                    BackgroundColor = Application.Current?.RequestedTheme == AppTheme.Dark
                        ? Color.FromArgb(MarkdownColors.Dark.CodeBackground)
                        : Color.FromArgb(MarkdownColors.Light.CodeBackground),
                });
            }
            pos = m.Index + m.Length;
        }

        // Remaining plain text
        if (pos < text.Length)
        {
            fs.Spans.Add(new Span
            {
                Text = text.Substring(pos),
                TextColor = Application.Current?.RequestedTheme == AppTheme.Dark
                    ? Color.FromArgb("#D0D0D0")
                    : Color.FromArgb("#333333"),
            });
        }

        return fs;
    }
}
