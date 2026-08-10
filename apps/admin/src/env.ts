export interface AdminConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  username: string;
  password: string;
  port: number;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AdminConfig {
  const supabaseUrl = required(environment, "SUPABASE_URL");
  const serviceRoleKey = required(environment, "SUPABASE_SERVICE_ROLE_KEY");
  const username = required(environment, "ADMIN_USERNAME");
  const password = required(environment, "ADMIN_PASSWORD");
  const port = Number(environment.ADMIN_PORT ?? "4010");

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("ADMIN_PORT must be an integer between 1 and 65535");
  }
  if (password.length < 16) {
    throw new Error("ADMIN_PASSWORD must contain at least 16 characters");
  }
  return { supabaseUrl, serviceRoleKey, username, password, port };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}
