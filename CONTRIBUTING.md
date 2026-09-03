# Contributing to Nuxt Endpoints

Thanks for your interest in contributing! The project is in beta, so issues, questions, and small focused pull requests are all welcome.

## Project layout

- `src/` — the Nuxt module and its runtime (`src/runtime/`).
- `playground/` — a Nuxt app used for manual testing (`vp run dev`).
- `site/` — the documentation site (`vp run site:dev`).
- `docs/` — maintainer architecture, migration, and release notes.
- `test/` — unit tests and the Nuxt integration test fixture.

## Getting set up

Requires Node 22.19+, 24.11+, or 26+ and [Vite+](https://viteplus.dev).

The `tsc` command resolves to TypeScript 7. Build tooling that needs the
Compiler API resolves `typescript` to the official TypeScript 6 compatibility
package until the TypeScript 7 API is available.

```bash
vp install
vp run dev:prepare   # stub build + prepare (run once, and after changing module entry points)
vp run dev           # playground with the module loaded
```

## Before opening a pull request

Run the full check — CI runs the same command:

```bash
vp run check
```

It covers formatting (`oxfmt`), linting (`oxlint`), type checks, unit tests, and the Nuxt integration tests. Useful subsets while iterating:

```bash
vp run test            # unit tests
vp run test:e2e        # integration tests through a real Nuxt build
vp run typecheck       # module types
vp run fmt             # apply formatting
```

## Guidelines

- Keep pull requests focused on one change. Small PRs get reviewed quickly.
- Add or update tests for behavior changes; the integration fixture in `test/` verifies route discovery, generated types, client typing, runtime responses, and OpenAPI output.
- Public API is not stable yet (pre-1.0). Breaking-change proposals are fine, but open an issue first so the design can be discussed.
- User documentation lives in `site/content/docs/` and the README. Maintainer
  architecture and migration notes live in `docs/`. Doc-only PRs are welcome.

## Reporting bugs

Please include:

- The route definition (`defineEndpoint`) and handler involved.
- The schema library and its version (Zod v4 / Valibot / Effect).
- Nuxt and `nuxt-endpoints` versions.
- What you expected, and what happened instead — generated-type issues are easiest to fix with a minimal reproduction repo.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
