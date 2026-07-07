// Build the Markdown body of a "forward document to chat" message (feature #511):
// a bold title line followed by a titled link — `**title**\n[title](link)`.
//
// #511 review blocker: `messageTitle` is the live document title, which is
// user-controlled, and it used to be interpolated raw into both the bold run and
// the link label. A title containing `] [ ) * \` or a line break could break out
// of the card structure — forging a misleading link or tampering with the rendered
// message. (This is structural forgery, not XSS: rehype-sanitize already strips
// scripts.) So we escape the title for the text / link-label context and wrap +
// escape the URL destination before assembling the message.

// Markdown-significant characters that must be neutralised inside inline text and
// link labels so they render literally instead of as syntax.
const MARKDOWN_SPECIAL = /[\\`*_{}[\]()#+\-.!<>|~]/g;

/**
 * Backslash-escape every Markdown-significant char and collapse line breaks to a
 * single space, so an arbitrary title stays one inline run in both the bold and
 * the link-label context (react-markdown drops the backslash on render).
 */
export function escapeForwardTitle(title: string): string {
  return title.replace(/[\r\n]+/g, " ").replace(MARKDOWN_SPECIAL, "\\$&");
}

/**
 * Escape the characters that would terminate an angle-bracket link destination
 * (the `<url>` form) and drop line breaks. Angle brackets let the destination
 * carry otherwise-tricky characters, but `<`, `>` and newlines still need to go.
 */
export function escapeForwardLinkDestination(link: string): string {
  return link
    .replace(/[\r\n]+/g, "")
    .replace(/\\/g, "%5C")
    .replace(/</g, "%3C")
    .replace(/>/g, "%3E");
}

/**
 * Assemble the forwarded-doc message body: a bold title line followed by a link
 * whose VISIBLE TEXT is the real URL itself — `**title**\n[<url>](<url>)`.
 *
 * #511 problem 1 (option A, boss-approved): the recipient must be able to *see*
 * the true destination URL on the card and click it, not just a title-labelled
 * anchor that hides the URL behind the `href`. So the link label is the real URL
 * (host + path + query), which stays clickable to the same destination and, being
 * a bare-URL link (visible text === href), is middle-ellipsized for compactness by
 * MarkdownContent's `a` renderer while the full URL remains in the href + title
 * tooltip (AC-13b). The bold title is retained on the line above.
 *
 * The URL is app-generated (buildDocLink) and carries no Markdown-structural
 * characters, so it is safe to use verbatim as the link label; only the
 * user-controlled title is escaped. The destination is still angle-bracket wrapped
 * and escaped so a title-adjacent edge case cannot break out of the link.
 */
export function buildForwardMessageText(title: string, link: string): string {
  const safeTitle = escapeForwardTitle(title);
  const safeLink = escapeForwardLinkDestination(link);
  return `**${safeTitle}**\n[${link}](<${safeLink}>)`;
}
