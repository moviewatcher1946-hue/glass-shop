# Glass Shop

Express + PostgreSQL + vanilla JS storefront with a glassmorphism UI.

## Run locally
1. `createdb glassshop`
2. `cp .env.example .env` (edit DATABASE_URL if needed)
3. `npm install && npm run dev` -> http://localhost:3000
Tables are created and the admin user is seeded automatically on startup.

## Deploy on Render
1. Push this folder to GitHub.
2. Render > New > Blueprint > pick the repo (uses render.yaml: web service + free Postgres).
3. Set ADMIN_PASSWORD when prompted. It is only used the first time, to seed the admin.

## API
POST /api/auth/signup | /login, GET /api/auth/me
GET /api/products[/:id[/image]]
Admin: POST/PUT/DELETE /api/products, PATCH /api/products/:id/sold-out, GET /api/orders
Customer: POST /api/orders, GET /api/orders/mine
