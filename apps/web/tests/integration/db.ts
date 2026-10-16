import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const repoRoot = path.resolve(__dirname, "../../../..");
const supabaseDir = path.join(repoRoot, "supabase");

const adminUrl =
  process.env.TEST_DATABASE_ADMIN_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

function readSql(file: string) {
  return readFileSync(path.join(supabaseDir, file), "utf8");
}

function migrationFiles() {
  return readdirSync(path.join(supabaseDir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join("migrations", f));
}

/** A throwaway database with the Supabase shim, every migration and (optionally) the seed. */
export async function createTestDatabase({ seed = false } = {}) {
  const name = `beta_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(readSql("tests/supabase-shim.sql"));
  for (const file of migrationFiles()) await client.query(readSql(file));
  if (seed) await client.query(readSql("seed.sql"));

  return {
    client,
    async drop() {
      await client.end();
      const a = new pg.Client({ connectionString: adminUrl });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}

export type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;

/** Inserts an auth user the way Supabase does after a Google sign-in. */
export async function createAuthUser(client: pg.Client, email: string, fullName: string) {
  const id = randomUUID();
  await client.query(
    `insert into auth.users (id, aud, role, email, email_confirmed_at, raw_user_meta_data)
     values ($1, 'authenticated', 'authenticated', $2, now(), $3)`,
    [id, email, { full_name: fullName, avatar_url: `https://example.test/${id}.png`, email_verified: true }],
  );
  return id;
}

/**
 * Runs `fn` inside a transaction as the given API role, the way PostgREST does for a
 * request with that user's JWT. The transaction is always rolled back unless `commit`.
 */
export async function as<T>(
  client: pg.Client,
  userId: string | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
  { commit = true } = {},
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" }),
    ]);
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query(commit ? "commit" : "rollback");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}
