# @octo/mail

Agent Mail workspace for OCTO Web.

The frontend uses the stable `/mail-api` path. Development and production proxies route it to the authenticated OCTO server Mail Gateway, so application code does not depend on a deployment-specific host and never carries an octo-mail owner credential.

## Configuration

| Variable            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `VITE_MAIL_API_URL` | OCTO server origin used by the Vite development proxy         |
| `MAIL_API_URL`      | OCTO server origin used by the production Nginx proxy         |
| `VITE_AGENT_MAIL_API_URL` | Direct octo-mail origin used by the development-only CLI path |
| `AGENT_MAIL_API_URL` | Direct octo-mail origin used by the production CLI path       |

Both proxies rewrite `/mail-api/*` to `/v1/mail-gateway/*` and preserve the
browser `token` and `X-Space-Id` headers. The gateway, not the browser or web
container, maps the authenticated OCTO user and Space to a provisioned mailbox
owner.

Agent CLI requests use `/agent-mail-api/*` on the same public OCTO base URL.
That path forwards the profile-bound `omb_` mailbox credential directly to
octo-mail and strips OCTO session/Space headers. Keeping the paths separate
prevents the human gateway from overwriting Agent credentials while preserving
one CLI base-URL configuration.
