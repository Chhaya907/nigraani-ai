import type { CookieOptions } from "express";

function isSecureRequest(req: any) {
  if (req?.protocol === "https") return true;

  const forwardedProto = req?.headers?.["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList: string[] = Array.isArray(forwardedProto)
    ? forwardedProto
    : typeof forwardedProto === "string"
    ? forwardedProto.split(",")
    : [];

  return protoList.some((proto: string) => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: any
): CookieOptions {
  const isSecure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
    domain: undefined,
  };
}
