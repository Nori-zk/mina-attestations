# Security Audit

Last run: 2026-04-28

```
npm audit
```

## Summary

This project has **5 known vulnerabilities** (3 low, 2 moderate). We are being upfront about this because transparency matters more than a clean badge.

**None of these vulnerabilities affect the published `@nori-zk/mina-attestations` package or its build output.** Every single one originates from the example web demo app at `examples/web-demo/`, which is a development-only Vite/React application. Consumers of this library will not inherit any of these vulnerabilities.

## Why they exist

All 5 vulnerabilities are transitive dependencies of packages used exclusively in the example web demo:

### elliptic / secp256k1 / @zkpass/transgate-js-sdk (3 low)

- **Advisory:** [GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84) — Elliptic uses a cryptographic primitive with a risky implementation
- **Chain:** `@zkpass/transgate-js-sdk` -> `secp256k1` -> `elliptic`
- **Why we can't fix it:** Every published version of `@zkpass/transgate-js-sdk` (including the latest `0.4.5`) depends on `secp256k1@^5.0.0`, which pulls in the vulnerable `elliptic`. This is an upstream issue that only zkpass can resolve. The only "fix" npm offers is downgrading to `@zkpass/transgate-js-sdk@0.1.1`, which is a breaking change and still wouldn't resolve the underlying `elliptic` issue in newer versions.

### esbuild / vite (2 moderate)

- **Advisory:** [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild enables any website to send requests to the development server and read the response
- **Chain:** `vite` -> `esbuild`
- **Why we can't fix it:** The fix requires `vite@8.0.10`, which is a major version bump and a breaking change for the example app. This vulnerability only applies to the local Vite dev server and has no impact outside of local development.

## Why this does not affect the build

The published package (`@nori-zk/mina-attestations`) is a TypeScript library compiled to plain JavaScript modules. The build output in `build/` contains only the library's own code with external imports limited to:

- `o1js`
- `zod`
- `ethers`
- Node.js built-ins

None of the vulnerable packages (`elliptic`, `secp256k1`, `esbuild`, `vite`) are dependencies of the library, are referenced in the build output, or are included in the `files` field of `package.json`. They exist solely in `node_modules` because the example web demo is a workspace member.

## What we are doing about it

- Monitoring upstream `@zkpass/transgate-js-sdk` releases for a fix to the `elliptic` dependency
- Will upgrade `vite` in the example app when a compatible major version is available
- Running `npm audit` as part of our release process
