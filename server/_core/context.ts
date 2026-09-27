import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { DEMO_ACCOUNTS, type RoleKey } from "../../shared/monitoring";
import { sdk } from "./sdk";

export const DEMO_SESSION_COOKIE = "nigraani_demo_session";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

type DemoSession = {
  role: RoleKey;
  username: string;
};

function readCookie(req: any, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  const pair = header
    .split(";")
    .map((value: string) => value.trim())
    .find((value: string) => value.startsWith(`${name}=`));
  if (!pair) return undefined;
  const rawValue = pair.slice(name.length + 1);
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function parseSessionPayload(raw: string): DemoSession | null {
  try {
    let clean = raw.trim();
    if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
      clean = clean.slice(1, -1);
    }
    if (clean.startsWith("j:")) {
      clean = clean.slice(2);
    }
    let parsed: any = JSON.parse(clean);
    if (typeof parsed === "string") {
      parsed = JSON.parse(parsed);
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.role === "string" &&
      typeof parsed.username === "string"
    ) {
      return {
        role: parsed.role as RoleKey,
        username: parsed.username,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function demoUserFromRequest(req: any): User | null {
  let raw = readCookie(req, DEMO_SESSION_COOKIE);
  if (!raw) {
    const headerVal = req.headers?.["x-demo-session"];
    if (typeof headerVal === "string" && headerVal.trim().length > 0) {
      try {
        raw = decodeURIComponent(headerVal);
      } catch {
        raw = headerVal;
      }
    }
  }
  if (!raw) return null;

  const session = parseSessionPayload(raw);
  if (!session) return null;

  const index = DEMO_ACCOUNTS.findIndex(item => item.role === session.role && item.username === session.username);
  const account = DEMO_ACCOUNTS[index];
  if (!account) return null;
  const now = new Date();
  return {
    id: 10_000 + index,
    openId: `demo-${account.role}`,
    name: account.name,
    email: account.email,
    loginMethod: "demo",
    role: account.role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  const req = opts.req as any;
  const demoUser = demoUserFromRequest(req);
  if (demoUser) {
    return { req: opts.req, res: opts.res, user: demoUser };
  }

  let user: User | null = null;
  const cookieHeader = req.headers?.cookie;
  const authHeader = req.headers?.authorization;
  const hasOAuthToken = Boolean(
    (cookieHeader && cookieHeader.includes(COOKIE_NAME)) ||
    (authHeader && typeof authHeader === "string" && authHeader.trim().length > 0)
  );

  if (hasOAuthToken) {
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      user = null;
    }
  }

  return { req: opts.req, res: opts.res, user };
}
