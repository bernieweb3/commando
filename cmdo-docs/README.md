# Commando Docs

Public documentation site for [Commando](https://github.com/MystenLabs/sui-commando) (`cmdo`) — a natural-language CLI agent for the Sui ecosystem. This folder is a [cmdocs](https://cmdocs.sh) project; every push to `main` rebuilds and deploys the site.

**Tracks:** Commando `v0.2.4-beta`.

## Pages

| Path | Purpose |
|---|---|
| `index.mdx` | Landing page — what Commando is and the 60-second tour |
| `quickstart.mdx` | Install → configure LLM → first prompt in under 5 minutes |
| `guides/installation.mdx` | Cross-platform install, env vars, optional R2 mirror |
| `guides/architecture.mdx` | Components, data flow, security posture |
| `guides/llm-setup.mdx` | OpenAI / OpenRouter / mock planner |
| `guides/safety.mdx` | Two-layer safety gate and pattern lists |
| `guides/troubleshooting.mdx` | Common errors and the runtime hints printed for them |
| `examples/sui-flows.mdx` | Wallet, faucet, gas, build, publish cookbook |
| `examples/walrus-sites.mdx` | End-to-end Walrus Sites deploy walkthrough |
| `reference/cli.mdx` | Every `cmdo` subcommand and flag |
| `reference/env-vars.mdx` | Every `CMDO_*` / `OPENAI_*` / `OPENROUTER_*` variable |

## Local development

Requires Node 20+ or Bun 1.0+.

```bash
npx cmdocs dev      # http://localhost:3000, hot reload
npx cmdocs check    # validate docs.json + MDX frontmatter + internal links
```

## Project structure

```
.
├── docs.json                 # Site config — name, theme, navigation, navbar, SEO
├── index.mdx
├── quickstart.mdx
├── guides/
│   ├── installation.mdx
│   ├── architecture.mdx
│   ├── llm-setup.mdx
│   ├── safety.mdx
│   └── troubleshooting.mdx
├── examples/
│   ├── sui-flows.mdx
│   └── walrus-sites.mdx
├── reference/
│   ├── cli.mdx
│   └── env-vars.mdx
└── public/
    ├── favicon.svg
    └── logo/
        ├── light-logo-only.svg
        ├── dark-logo-only.svg
        ├── light.svg
        └── dark.svg
```

## Updating for a new Commando release

1. Bump every `0.2.4-beta` mention (search-and-replace across `*.mdx` and `docs.json` `seo.description` + `footer.text`).
2. If new subcommands or env vars shipped, add rows to `reference/cli.mdx` / `reference/env-vars.mdx`.
3. Move release notes / migration tips into `guides/troubleshooting.mdx` if the new version changes a known error path.
4. Run `npx cmdocs check` and fix any broken links before pushing.

## Validate

```bash
npx cmdocs check
```

Wire it into a git pre-commit hook so broken docs never reach `main`.

## Deploy

cmdocs is push-to-deploy. Connect this repo in the [cmdocs dashboard](https://cmdocs.sh) and every commit triggers a build that lands at `<your-project>.cmdocs.app`.

## Source of truth

When a doc disagrees with the code, the code wins. Always double-check claims against:

- `src/index.ts` — CLI subcommands and flags.
- `src/config/defaults.ts` — model defaults, R2 toggle.
- `src/llm/planner.ts` — system prompt and validation rules.
- `src/safety/gate.ts` — pattern lists.
- `src/bootstrap/download-gh.ts` — supported (OS, arch) triples and pinned upstream URLs.

## Learn more about cmdocs

- [cmdocs Documentation](https://docs.cmdocs.sh)
- [cmdocs Dashboard](https://cmdocs.sh)
