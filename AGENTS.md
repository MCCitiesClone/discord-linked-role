# Repository Guidelines

## Project Structure & Module Organization

This is a small TypeScript Discord Linked Role service. Runtime code lives in `src/`: `app.ts` defines the shared Hono application, `server.ts` runs it locally, `discord.ts` wraps Discord API calls, `storage.ts` handles token persistence, `config.ts` loads environment variables, and `register.ts` registers the metadata schema. `api/index.ts` is the Vercel Serverless Function entry point. Static tutorial images belong in `assets/`. Deployment routing is in `vercel.json`; dependency state is locked in `aube-lock.yaml`.

## Build, Test, and Development Commands

Use `aube`, not `npm` or `pnpm`.

- `aube install`: install dependencies from `aube-lock.yaml`.
- `aube run dev`: start the local Hono server from `src/server.ts`.
- `aube run build`: run `tsc --noEmit` for type checking.
- `aube run register`: register the Discord linked-role metadata schema using local environment variables.
- `aube test`: currently runs the placeholder test script and exits with failure until real tests are added.

## Coding Style & Naming Conventions

Write TypeScript as ES modules and keep imports explicit with `.js` extensions for local files, matching the existing `NodeNext` configuration. The project uses strict TypeScript settings; avoid `any` unless there is a narrow reason. Use two-space indentation, single quotes, semicolons, `camelCase` for variables/functions, and `UPPER_SNAKE_CASE` for environment variables. Keep route handlers small and push Discord or storage-specific logic into the existing helper modules.

## Testing Guidelines

There is no test framework configured yet. Before adding behavior with risk, add a focused test setup and update the `test` script so `aube test` is useful. Prefer tests near the source they exercise or under a future `test/` directory, with names like `app.test.ts` or `discord.test.ts`. At minimum, run `aube run build` before opening a pull request.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, lowercase messages such as `add metadata schema route` and `fix oauth redirect uri`. Follow that style and keep each commit scoped. Pull requests should describe the behavior change, list verification commands such as `aube run build`, call out environment or Vercel changes, and link any related issue. Include screenshots only when changing the admin HTML page or visible routes.

## Security & Configuration Tips

Do not commit `.env` or real Discord, cookie, admin, or Redis secrets. Use `.env.example` as the template for required variables. When testing OAuth locally, keep `DISCORD_REDIRECT_URI` aligned with the public tunnel URL and the Discord Developer Portal redirect entry.
