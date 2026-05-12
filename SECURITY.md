# Security Policy

## Supported Versions

This project is pre-launch. Only the `main` branch is currently supported.

| Version | Supported |
|---------|-----------|
| `main`  | ✅        |
| forks   | ❌        |

## Reporting a Vulnerability

**Please do not open public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability in Project_CEMA, please report it
privately by one of the following methods:

1. **GitHub Security Advisories** (preferred):
   Use the "Report a vulnerability" button on the
   [Security tab](../../security/advisories/new) of this repository.

2. **Email**: `security@example.com` with subject `[SECURITY] Project_CEMA`.
   *(This is a placeholder. Configure a real `security@<your-domain>` mailbox before public launch.)*

Please include:

- A description of the issue and its potential impact
- Steps to reproduce (with example code or commands where possible)
- Any proof-of-concept exploit
- Your name and contact info (optional — anonymous reports accepted)

## Disclosure Process

1. We acknowledge receipt within **2 business days**.
2. We confirm the vulnerability and determine severity within **7 business days**.
3. We develop and test a fix.
4. We coordinate a disclosure timeline with the reporter.
5. We release the fix and publish a security advisory.

## Scope

In scope:

- Authentication and authorization flaws
- Server-side request forgery (SSRF)
- Cross-site scripting (XSS)
- SQL injection / ORM injection
- Sensitive data exposure (PII, secrets, audit-log tampering)
- Bypass of attorney-review gate
- Bypass of multi-tenant isolation (Row-Level Security)
- Workflow durability / replay attacks
- AI prompt injection leading to unauthorized actions
- Supply chain (dependency confusion, typosquatting)

Out of scope:

- Vulnerabilities in third-party services (report directly to the vendor)
- Social engineering of project maintainers
- Physical security
- Denial of service via volumetric attacks (use Vercel's WAF reporting)

## Safe Harbor

We will not pursue civil or criminal action against researchers acting in
good faith, who:

- Avoid privacy violations and destruction of data
- Do not exploit a vulnerability beyond what is necessary to demonstrate it
- Report through one of the channels above
- Give us reasonable time to respond before public disclosure

## Bug Bounty

A formal bug-bounty program is planned post-SOC 2 Type II certification
(target: 12 months post-launch). Until then, we offer recognition in our
acknowledgments page and may offer ad-hoc bounties at our discretion.

## PGP Key

PGP key for encrypted reports: *(to be published before public launch)*
