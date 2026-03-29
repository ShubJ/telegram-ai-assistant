import { config as loadDotenv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load .env from the project root directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "..", "..", ".env") });

export interface AppConfig {
  telegramBotToken: string;
  anthropicApiKey: string;
  claudeModel: string;
  port: number;
  nodeEnv: "development" | "production" | "test";
  adminSecret: string;
  braveSearchApiKey: string;
  openweatherApiKey: string;
  githubToken: string;
  databasePath: string;
  logLevel: string;
}

function optionalEnv(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : defaultValue;
}

function parsePort(raw: string): number {
  const port = parseInt(raw, 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid PORT value "${raw}". Must be an integer between 1 and 65535.`
    );
  }
  return port;
}

function parseNodeEnv(raw: string): AppConfig["nodeEnv"] {
  if (raw === "development" || raw === "production" || raw === "test") {
    return raw;
  }
  // Can't use logger here since config is loaded before logger is initialized
  process.stderr.write(`[WARN] Unknown NODE_ENV value "${raw}", defaulting to "development".\n`);
  return "development";
}

function buildConfig(): AppConfig {
  // Validate required fields first so we surface all missing vars at once
  const missingVars: string[] = [];

  const checkRequired = (key: string): string => {
    const value = process.env[key];
    if (!value || value.trim() === "") {
      missingVars.push(key);
      return "";
    }
    return value.trim();
  };

  const telegramBotToken = checkRequired("TELEGRAM_BOT_TOKEN");
  const anthropicApiKey = checkRequired("ANTHROPIC_API_KEY");

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missingVars.map((v) => `  - ${v}`).join("\n") +
        `\n\nPlease set these in your .env file or environment.`
    );
  }

  const portRaw = optionalEnv("PORT", "3000");
  const nodeEnvRaw = optionalEnv("NODE_ENV", "development");
  const databasePathRaw = optionalEnv(
    "DATABASE_PATH",
    path.resolve(__dirname, "..", "data", "assistant.db")
  );

  const nodeEnv = parseNodeEnv(nodeEnvRaw);

  return {
    telegramBotToken,
    anthropicApiKey,
    claudeModel: optionalEnv("CLAUDE_MODEL", "claude-sonnet-4-20250514"),
    port: parsePort(portRaw),
    nodeEnv,
    adminSecret: optionalEnv("ADMIN_SECRET", ""),
    braveSearchApiKey: optionalEnv("BRAVE_SEARCH_API_KEY", ""),
    openweatherApiKey: optionalEnv("OPENWEATHER_API_KEY", ""),
    githubToken: optionalEnv("GITHUB_TOKEN", ""),
    databasePath: databasePathRaw,
    logLevel: optionalEnv("LOG_LEVEL", nodeEnv === "development" ? "debug" : "info"),
  };
}

// Build and export config singleton — will throw on startup if required vars are absent
export const config: AppConfig = buildConfig();
