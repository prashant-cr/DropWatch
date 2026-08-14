# Security policy

## Reporting a vulnerability

Please report security issues privately through
[GitHub's advisory form](https://github.com/prashant-cr/DropWatch/security/advisories/new)
rather than opening a public issue.

Include what an attacker can do, and enough detail to reproduce it. You will get a
first response within a week. There is no bounty programme — this is a hobby project
— but you will be credited in the advisory unless you would rather not be.

## What DropWatch assumes about its environment

DropWatch is a single-user tool that runs on your own machine. Several deliberate
choices follow from that, and they are worth understanding before you expose it to
anything wider.

**There is no authentication.** Anyone who can reach the port can add, edit and
delete watches and read your SMTP settings. This is why the server binds to
`127.0.0.1` by default. If you change `HOST`, put a reverse proxy with real
authentication in front of it — do not put it straight onto a LAN, let alone the
internet.

**The SMTP password is stored in plain text**, in `data/dropwatch.db`. It has to be
recoverable to authenticate to your mail server, and a zero-config local tool has no
second secret to encrypt it with. DropWatch does what it can: the database file and
its write-ahead log are created `0600`, so other accounts on the machine cannot read
them, and the password is never sent back to the browser or included in any API
response. Use a provider-specific app password (Gmail) or a scoped API key (Resend)
rather than your real account password, so the blast radius is one revocable
credential.

**The checker will not visit your local network.** DropWatch points a real browser at
whatever URL is stored, so URLs resolving to loopback, private, link-local or CGNAT
addresses are rejected — including the cloud metadata endpoint at `169.254.169.254`.
Set `DROPWATCH_ALLOW_PRIVATE_HOSTS=1` if you genuinely are watching a store on your
own network. Note this validates the URL, not the DNS answer: a public hostname whose
record points inside your network is not caught.

**Watched pages are untrusted input.** Extraction runs over the rendered DOM of sites
we do not control. Page content is treated as data, never evaluated, and headless
Chromium is the sandbox boundary — keep Playwright up to date, since that is what
ships the browser security fixes.

## Out of scope

Anything that requires already having an account on the machine running DropWatch, or
having already been given network access to the port, is not a vulnerability in
DropWatch — that is the threat model above, working as documented.

Reports asking us to bypass a store's bot protection are not security reports. See
the [contributing guide](CONTRIBUTING.md#what-will-not-be-merged).
