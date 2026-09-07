declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    APP_ORIGIN: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    BETTER_AUTH_SECRET: string;
  }
}
