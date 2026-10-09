CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          VARCHAR(10) NOT NULL DEFAULT 'customer' CHECK (role IN ('admin','customer','seller')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Case-insensitive uniqueness so nobody can register "Raven"
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users (lower(username));

-- Images are stored in Postgres (image_data) so they survive Render's ephemeral disk.
-- image_url points at GET /api/products/:id/image.
CREATE TABLE IF NOT EXISTS products (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price       NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  is_sold_out BOOLEAN NOT NULL DEFAULT false,
  image_url   TEXT,
  image_data  BYTEA,
  image_mime  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS custom_requests (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  description  TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','quoted','accepted','declined','unavailable')),
  quoted_price NUMERIC(10,2) CHECK (quoted_price >= 0),
  admin_note   TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS custom_requests_user ON custom_requests (user_id);
CREATE TABLE IF NOT EXISTS orders (
  id         SERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id),
  total      NUMERIC(10,2) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id         SERIAL PRIMARY KEY,
  order_id   INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id) ON DELETE SET NULL,
  title      TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity   INT NOT NULL CHECK (quantity > 0)
);

-- Who did what (shown to the main admin under Activity). No links to other tables, so a log line survives a deleted seller or product.
CREATE TABLE IF NOT EXISTS audit_log (
  id       BIGSERIAL PRIMARY KEY,
  at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id  INT,
  username TEXT NOT NULL,
  role     TEXT,
  action   TEXT NOT NULL,
  detail   TEXT
);

-- Hearts on products, one row per customer per product.
CREATE TABLE IF NOT EXISTS favorites (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
