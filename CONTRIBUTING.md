# Contributing

Thanks for your interest in **proxy-api-checker**.

## Development setup

```bash
cp wrangler.toml.example wrangler.toml
npm install
npm test
npm run dev
```

Do not commit `wrangler.toml`, `.dev.vars`, or anything under `doc/` (local-only).

## Pull requests

1. Fork and create a branch from `main`.
2. Keep changes focused; include tests for behavior changes.
3. Run `npm test` before opening a PR.

## Code style

- TypeScript strict mode
- Prefer small pure functions in `src/` with tests in `test/`

## Reporting issues

Include: expected behavior, actual behavior, steps to reproduce, and whether you use `PROTECTION_MODE=strict`.
