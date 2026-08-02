import { once } from "node:events";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const supportDirectory = dirname(fileURLToPath(import.meta.url));
const backendDirectory = resolve(supportDirectory, "../../../backend");
const temporaryRoot = await realpath(tmpdir());
const dataDirectory = await mkdtemp(join(temporaryRoot, "tso-playwright-"));
const databasePath = join(dataDirectory, "app.db");
const testEnvironment = {
  ...process.env,
  TSO_ENVIRONMENT: "test",
  TSO_DATA_DIR: dataDirectory,
  TSO_DATABASE_URL: `sqlite+aiosqlite:///${databasePath}`,
  TSO_MASTER_KEY: "playwright-only-master-key-never-use-outside-tests-2026",
  TSO_PUBLIC_ORIGIN: "http://127.0.0.1:4174",
  TSO_ALLOWED_HOSTS: "127.0.0.1,localhost",
  TSO_COOKIE_SECURE: "false",
  TSO_ALLOW_REGISTRATION: "true",
  TSO_PROCESS_SCANS_IN_API: "false",
  TSO_TELEGRAM_API_ID: "",
  TSO_TELEGRAM_API_HASH: "",
};

function run(command, args) {
  return spawn(command, args, {
    cwd: backendDirectory,
    env: testEnvironment,
    stdio: "inherit",
  });
}

async function removeTestData() {
  const [resolvedDataDirectory, metadata] = await Promise.all([
    realpath(dataDirectory),
    lstat(dataDirectory),
  ]);
  const hasExpectedLocation = dirname(resolvedDataDirectory) === temporaryRoot;
  const hasExpectedName = basename(resolvedDataDirectory).startsWith("tso-playwright-");
  const isExactDirectory = resolvedDataDirectory === dataDirectory
    && metadata.isDirectory()
    && !metadata.isSymbolicLink();

  if (!hasExpectedLocation || !hasExpectedName || !isExactDirectory) {
    throw new Error(`Refusing to remove unexpected E2E data directory: ${dataDirectory}`);
  }

  await rm(resolvedDataDirectory, { recursive: true, force: true });
}

const migration = run("uv", ["run", "alembic", "-c", "alembic.ini", "upgrade", "head"]);
const [migrationCode, migrationSignal] = await once(migration, "exit");
if (migrationCode !== 0) {
  await removeTestData();
  throw new Error(`E2E database migration failed (${migrationSignal ?? migrationCode}).`);
}

const server = run("uv", [
  "run",
  "uvicorn",
  "app.main:app",
  "--host",
  "127.0.0.1",
  "--port",
  "8510",
]);
let isStopping = false;

async function stop(signal = "SIGTERM", exitCode = 0) {
  if (isStopping) {
    return;
  }
  isStopping = true;

  if (server.exitCode === null && server.signalCode === null) {
    server.kill(signal);
    const forceKill = setTimeout(() => server.kill("SIGKILL"), 4_000);
    forceKill.unref();
    await once(server, "exit");
    clearTimeout(forceKill);
  }

  await removeTestData();
  process.exit(exitCode);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));
server.on("exit", (code) => {
  if (!isStopping) {
    void stop("SIGTERM", code ?? 1);
  }
});
