# Contributing

Run `pnpm build`, `pnpm test`, and `pnpm typecheck` before opening a pull request. Privacy regressions are release blockers. Add fixture coverage for new capture or replay behavior.

## Current improvement pass

Use pnpm 10.12.1 with Node 22+ in one operating-system environment. `pnpm dev` starts the practice recorder (5173) and viewer (5174). The old root-only npm lockfile was removed because it did not describe the pnpm workspaces. Run `pnpm install` to create the workspace lockfile, and commit that file before enabling frozen-lockfile installation/cache keys in CI.

The earlier UI improvement pass deferred tests at the owner's request. The current automatic-monitoring pass runs builds, repository tests, typechecks, and real Chromium extension acceptance. Run `pnpm local:build` and `pnpm test:extension` for the local capture/delivery flow; install Chromium with the CLI's Playwright dependency first. Broad accessibility, replay, adversarial privacy, and long-running performance acceptance remain outstanding. See [local validation](LOCAL_MONITORING.md) and `PRD_AUDIT.md` for scope.
