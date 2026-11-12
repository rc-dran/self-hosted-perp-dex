# Security

This app handles an OpenFinance key that can trade and move funds, so we take reports seriously.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead: open the **Security** tab of this repository and choose **Report a vulnerability**.

Include what you found, how to reproduce it, and what an attacker could do with it. We will reply as soon as we can and credit you in the fix if you want.

## What is in scope

- Anything that lets a key leave the visitor's browser tab other than to the same-origin `/api/of`.
- Anything that gets a route outside the allowlist in `api/_allow.ts` through `/api/of`.
- Script injection through API or AI responses.
- Order maths that could send a materially different order from the one the user confirmed.

## If your key leaks

Revoke it on [openfinance.tech](https://openfinance.tech) right away and create a new one. Never post a key in an issue, a pull request, a screenshot or a chat.
