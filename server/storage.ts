// Hybrid persistent storage helper for Nigraani AI Production
// Supports:
// 1. AWS S3 / Cloudflare R2 / S3-compatible object storage via @aws-sdk/client-s3
// 2. Forge presigned S3 storage
// 3. Resilient local filesystem storage fallback

import { ENV } from "./_core/env";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "fs";
import path from "path";
import { getUploadsEvidenceDir } from "./uploadsDir";

function getS3Config() {
  const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || process.env.S3_REGION || "ap-south-1";
  const endpoint = process.env.AWS_S3_ENDPOINT || process.env.S3_ENDPOINT;

  if (bucket && accessKeyId && secretAccessKey) {
    const client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: Boolean(endpoint),
    });
    return { client, bucket, region };
  }
  return null;
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (forgeUrl && forgeKey) {
    return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
  }
  return null;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

  // 1. Check if S3 / Cloudflare R2 is configured
  const s3 = getS3Config();
  if (s3) {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: buf,
        ContentType: contentType,
      })
    );
    const publicUrl = process.env.AWS_S3_PUBLIC_URL_PREFIX
      ? `${process.env.AWS_S3_PUBLIC_URL_PREFIX.replace(/\/+$/, "")}/${key}`
      : `/api/storage/${key}`;
    return { key, url: publicUrl };
  }

  // 2. Check if Forge storage is configured
  const forge = getForgeConfig();
  if (forge) {
    const presignUrl = new URL("v1/storage/presign/put", forge.forgeUrl + "/");
    presignUrl.searchParams.set("path", key);

    const presignResp = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forge.forgeKey}` },
    });

    if (presignResp.ok) {
      const { url: s3Url } = (await presignResp.json()) as { url: string };
      if (s3Url) {
        const uploadResp = await fetch(s3Url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: buf,
        });
        if (uploadResp.ok) {
          return { key, url: `/manus-storage/${key}` };
        }
      }
    }
  }

  // 3. Fallback: Local filesystem storage
  const uploadsEvidenceDir = getUploadsEvidenceDir();
  const localFilePath = path.join(uploadsEvidenceDir, key);
  try {
    fs.writeFileSync(localFilePath, buf);
  } catch (_) {}
  return { key, url: `/uploads/evidence/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  const s3 = getS3Config();
  if (s3) {
    const signedUrl = await storageGetSignedUrl(key);
    return { key, url: signedUrl };
  }
  const forge = getForgeConfig();
  if (forge) {
    return { key, url: `/manus-storage/${key}` };
  }
  return { key, url: `/uploads/evidence/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);
  const s3 = getS3Config();
  if (s3) {
    const command = new GetObjectCommand({
      Bucket: s3.bucket,
      Key: key,
    });
    return await getSignedUrl(s3.client, command, { expiresIn: 3600 });
  }

  const forge = getForgeConfig();
  if (forge) {
    const getUrl = new URL("v1/storage/presign/get", forge.forgeUrl + "/");
    getUrl.searchParams.set("path", key);

    const resp = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${forge.forgeKey}` },
    });

    if (resp.ok) {
      const { url } = (await resp.json()) as { url: string };
      if (url) return url;
    }
  }

  return `/uploads/evidence/${key}`;
}
