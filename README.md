# Commando

> Natural-language CLI agent for the Sui ecosystem, Windows-first. Turn prompts into safe, grounded `sui` / `walrus` / `site-builder` commands.

> **Heads up:** the first install downloads **~850 MB of Mysten Labs CLIs**
> (sui, walrus, site-builder, and their service peers) into
> `%USERPROFILE%\.commando`. Set `CMDO_SKIP_BOOTSTRAP=1` before installing if
> you want to defer that to a later `cmdo bootstrap`.

## Quickstart for users (Windows 10/11, Node 20+)

```powershell
# 1. Install from npm. The postinstall hook downloads the binaries,
#    verifies SHA256, adds ~/.commando/bin to your user PATH, and
#    generates the AGENT.md skill manifest.
npm install -g commando-cli

# 2. Open a NEW terminal so PATH picks up the bin dir, then configure
#    your LLM provider (OpenAI or OpenRouter, API key + model).
cmdo init

# 3. Start using it.
cmdo "show active address" --sui
cmdo "list my blobs" --walrus
cmdo "show sitemap" --site-builder
cmdo doctor
```

If you ran `npm install` with `--ignore-scripts` (common in CI / locked-down
environments) or set `CMDO_SKIP_BOOTSTRAP=1`, trigger the download manually:

```powershell
cmdo bootstrap
```

## Quickstart for contributors

```powershell
git clone <repo> cmdo
cd cmdo
npm install --ignore-scripts
npm run build
npm run bootstrap
cmdo init
```

The manifest URL and the R2 auth token are hardcoded in
[src/config/defaults.ts](src/config/defaults.ts); users never need to enter
them. LLM credentials are the only per-user setting and are collected by
`cmdo init`.

## How it works

```
prompt -> safety(prompt) -> router -> planner (LLM) -> safety(plan) -> spawn
```

- **Bootstrap** (`src/bootstrap`) downloads every binary listed in
  `assets/r2-manifest.json`, enforces a SHA256 match, writes them flat into
  `%USERPROFILE%\.commando\bin`, and appends that directory to the user's
  registry PATH (no admin required).
- **Skill generator** (`src/skills`) runs `sui --help`, `walrus --help`,
  `site-builder --help` plus each subcommand `--help` and emits
  `AGENT.md`. Only these three user-facing tools are modeled - service
  binaries stay out of the LLM context.
- **Intent router** (`src/router`) honours explicit `--sui` / `--walrus` /
  `--site-builder` flags, then falls back to keyword inference.
- **LLM planner** (`src/llm`) calls OpenRouter with a strict system prompt
  that forces a JSON `{binary, args}` response. Unknown flags trigger one
  narrow retry; persistent drift raises a clear error. Set `CMDO_LLM_MOCK=1`
  for offline demos.
- **Safety gate** (`src/safety`) rejects destructive keywords, blocks paths
  outside `~/.commando/bin`, and strips path-traversal attempts.
- **Execution engine** (`src/exec`) uses `child_process.spawn(..., { shell: false })`
  and inherits stdio so you see the native tool output live.

## Environment variables

| Var | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Enable live LLM planning via OpenAI. | _(unset)_ |
| `OPENAI_MODEL` | Override the OpenAI model. | `gpt-4o-mini` |
| `OPENROUTER_API_KEY` | Enable live LLM planning via OpenRouter. | _(unset)_ |
| `OPENROUTER_MODEL` | Override the OpenRouter model slug. | `z-ai/glm-4.5-air:free` |
| `CMDO_LLM_MOCK` | Set to `1` to use the deterministic offline planner. | `0` |
| `CMDO_SKIP_BOOTSTRAP` | Set to `1` during `npm install` to skip the ~850 MB binary download; run `cmdo bootstrap` later. | _(unset)_ |
| `COMMANDO_HOME` | Override the install root (defaults to `~/.commando`). | _(unset)_ |
| `CMDO_DEBUG` | Set to any non-empty value for verbose logs. | _(unset)_ |
| `CMDO_DOWNLOAD_CONCURRENCY` | Parallel download workers during bootstrap. Set to `1` on weak networks. | `3` |
| `CMDO_DOWNLOAD_IDLE_MS` | Abort a download stream after this many ms without a new chunk. | `120000` |
| `CMDO_DOWNLOAD_RETRIES` | Attempts per file before giving up. Uses Range resume between attempts. | `3` |

## Commands

| Command | What it does |
| --- | --- |
| `cmdo <prompt>` | Plan and execute a natural-language request. |
| `cmdo init` | Interactively configure LLM provider (OpenAI or OpenRouter), API key + model. |
| `cmdo update-skills` | Regenerate `AGENT.md` from the installed binaries. |
| `cmdo doctor` | Show environment + per-binary SHA256 verification. |
| `cmdo bootstrap` | Re-run the download/PATH/skills bootstrap. |
| `cmdo --version` | Print version. |

## Safety model

- Every spawn goes through an allowlist: the resolved binary must live
  inside `%USERPROFILE%\.commando\bin`.
- Destructive patterns (`del`, `rmdir`, `rd`, `format`, `shutdown`,
  `reg delete`, `rm -rf`, bare `C:\`, `..\`) are rejected before the LLM
  ever sees the prompt.
- The planner cannot emit a flag that isn't present in the generated skill
  manifest. One narrow retry is given; persistent drift fails loudly.

## Project layout

```
commando/
  bin/cmdo.js              # node shim registered as the "cmdo" bin
  assets/r2-manifest.json  # pinned Mysten binary manifest (SHA256)
  src/
    index.ts               # Commander setup
    commands/              # run, update-skills, doctor
    bootstrap/             # paths, download + hash verify, PATH editor, orchestrator
    skills/                # --help parser + AGENT.md loader
    router/                # intent routing (flag + keyword)
    llm/                   # OpenRouter client + planner with validation
    safety/                # prompt + plan gates
    exec/                  # spawn wrapper
    utils/                 # logger, hash, errors
```

## Acceptance checks

- `npm run bootstrap` succeeds on a clean Windows box: 12/12 binaries land
  in `~/.commando/bin` with verified SHA256, PATH is updated.
- A fresh shell can run `sui --version`.
- `cmdo "show active address" --sui` plans `sui.exe client active-address`
  and executes it (or errors cleanly if no keystore exists).
- `cmdo update-skills` rewrites `AGENT.md` with current command signatures.
- `cmdo "delete everything in C drive"` is rejected by the safety gate
  before any spawn happens.
