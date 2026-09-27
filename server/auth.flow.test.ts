import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { createContext, DEMO_SESSION_COOKIE, type TrpcContext } from "./_core/context";
import { DEMO_ACCOUNTS, ROLE_KEYS, type RoleKey } from "../shared/monitoring";

type CookieCall = { name: string; val: string; options: Record<string, unknown> };

function mockExpressReqRes(overrides?: {
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
  protocol?: string;
}) {
  const cookieHeaders: string[] = [];
  if (overrides?.cookies) {
    for (const [k, v] of Object.entries(overrides.cookies)) {
      cookieHeaders.push(`${k}=${encodeURIComponent(v)}`);
    }
  }

  const setCookies: CookieCall[] = [];
  const req = {
    protocol: overrides?.protocol ?? "http",
    headers: {
      cookie: cookieHeaders.length ? cookieHeaders.join("; ") : undefined,
      ...overrides?.headers,
    },
  } as unknown as TrpcContext["req"];

  const res = {
    cookie: (name: string, val: string, options: Record<string, unknown>) => {
      setCookies.push({ name, val, options });
    },
    clearCookie: (name: string, options: Record<string, unknown>) => {
      setCookies.push({ name, val: "", options });
    },
  } as unknown as TrpcContext["res"];

  return { req, res, setCookies };
}

describe("Authentication & Session Flow", () => {
  it("unauthenticated request returns null for auth.me without missing session cookie warnings", async () => {
    const { req, res } = mockExpressReqRes();
    const ctx = await createContext({ req, res, info: {} as any });
    expect(ctx.user).toBeNull();

    const caller = appRouter.createCaller(ctx);
    const me = await caller.auth.me();
    expect(me).toBeNull();
  });

  for (const roleKey of ROLE_KEYS) {
    it(`logs in and creates valid session for role '${roleKey}'`, async () => {
      const account = DEMO_ACCOUNTS.find(a => a.role === roleKey)!;
      expect(account).toBeDefined();

      const { req, res, setCookies } = mockExpressReqRes();
      const ctx = await createContext({ req, res, info: {} as any });
      const caller = appRouter.createCaller(ctx);

      const loginResult = await caller.auth.demoLogin({
        username: account.username,
        password: account.password,
      });

      expect(loginResult.success).toBe(true);
      expect(loginResult.role).toBe(roleKey);
      expect(loginResult.user.role).toBe(roleKey);
      expect(loginResult.user.name).toBe(account.name);
      expect(setCookies).toHaveLength(1);

      const cookie = setCookies[0];
      expect(cookie.name).toBe(DEMO_SESSION_COOKIE);
      expect(cookie.options.sameSite).toBe("lax"); // On HTTP / localhost
      expect(cookie.options.httpOnly).toBe(true);
      expect(cookie.options.path).toBe("/");

      // Verify that subsequent request with the cookie creates authenticated context
      const authedReqRes = mockExpressReqRes({
        cookies: {
          [DEMO_SESSION_COOKIE]: cookie.val,
        },
      });
      const authedCtx = await createContext({ req: authedReqRes.req, res: authedReqRes.res, info: {} as any });
      expect(authedCtx.user).not.toBeNull();
      expect(authedCtx.user?.role).toBe(roleKey);
      expect(authedCtx.user?.name).toBe(account.name);

      // Verify protected API (snapshot) works without UNAUTHORIZED error
      const authedCaller = appRouter.createCaller(authedCtx);
      const snapshot = await authedCaller.monitoring.snapshot();
      expect(snapshot.user.role).toBe(roleKey);
      expect(snapshot.snapshot).toBeDefined();
    });
  }

  it("authenticates via x-demo-session header fallback", async () => {
    const account = DEMO_ACCOUNTS.find(a => a.role === "mospi")!;
    const headerReqRes = mockExpressReqRes({
      headers: {
        "x-demo-session": encodeURIComponent(JSON.stringify({ role: "mospi", username: account.username })),
      },
    });

    const ctx = await createContext({ req: headerReqRes.req, res: headerReqRes.res, info: {} as any });
    expect(ctx.user).not.toBeNull();
    expect(ctx.user?.role).toBe("mospi");

    const caller = appRouter.createCaller(ctx);
    const snapshot = await caller.monitoring.snapshot();
    expect(snapshot.user.role).toBe("mospi");
  });
});
