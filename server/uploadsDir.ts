import path from "path";
import fs from "fs";
import os from "os";

export function getUploadsBaseDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const dir = path.join(os.tmpdir(), "uploads");
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    return dir;
  }
  const dir = path.resolve(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

export function getUploadsEvidenceDir(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const dir = path.join(os.tmpdir(), "uploads", "evidence");
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    return dir;
  }
  const dir = path.resolve(process.cwd(), "uploads", "evidence");
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}
