# Repository Guidelines

## Project Structure & Module Organization

`server.js` is the app entrypoint (Express + sessions + route mounting). Core backend code lives in `src/`: database
config in `src/db.js`, HTTP routes in `src/routes/`, and notification integrations in `src/notifications/`.

UI templates are EJS views in `views/` with shared partials under `views/partials/`. Static frontend assets are in
`public/css`, `public/js`, and `public/assets`. SQL bootstrap/schema artifacts are in `sql/` (`sql/transportapp.sql`).
Runtime temp files may appear in `tmp/`.

## Build, Test, and Development Commands

- `npm install`: install dependencies.
- `npm run dev`: start local development server with `nodemon` (auto-reload).
- `npm start`: run production-like server with Node.

Environment variables are loaded from `.env` (see `.env.example` for required keys like `DB_*`, `SESSION_SECRET`, and
`BASE_URL`).

## Coding Style & Naming Conventions

Use CommonJS (`require`/`module.exports`) and 4-space indentation, matching existing files such as `server.js` and
`src/routes/public.js`. Keep route modules focused by domain (`admin`, `public`, `ticket`, `seo`, `telegramWebhook`).

Naming conventions:

- Use `camelCase` for variables/functions.
- Use `UPPER_SNAKE_CASE` for constants (example: `MAX_CAP`).
- Use descriptive EJS view names (`admin_agenda.ejs`, `admin_trip.ejs`).

## Testing Guidelines

There is currently no automated test suite configured (`package.json` has no `test` script). For now:

- Validate key flows manually: reserve, pay, ticket generation, and admin actions.
- Verify `/health` returns DB connectivity status before merging.
- If you add tests, prefer `*.test.js` naming and place them under `tests/`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative Spanish messages (for example, `Se agrega página 404.ejs`,
`Actualización de css...`). Keep commits focused and single-purpose.

For pull requests:

- Include a clear summary and impacted routes/views.
- Link related issue/ticket when available.
- Add screenshots for UI changes (`views/` or `public/css`).
- Document config or SQL changes explicitly.

## Security & Configuration Tips

Never commit secrets in `.env`. Keep `.env.example` updated when adding new variables. Validate webhook/payment
settings (`STRIPE_*`, Telegram, session secrets) in each environment before deployment.
