import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getRegistry } from "./registry";
import { env } from "./env";

let s3Client: S3Client | null = null;

async function getS3Client() {
  if (s3Client) return s3Client;

  const registry = await getRegistry();
  const endpoint = registry.endpoint || env.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || env.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 credentials in registry or environment variables (S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY).");
  }

  s3Client = new S3Client({
    endpoint,
    region: "auto",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    // Cloudflare R2 and other S3-compatible providers often work better with path-style access
    // but some might require virtual-hosted style. forcePathStyle: true is common for custom endpoints.
    forcePathStyle: true,
  });

  return s3Client;
}

/**
 * Fetches the content of a file from S3 as a string.
 */
export async function getFileFromS3(bucket: string, key: string): Promise<string> {
  const client = await getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  try {
    const response = await client.send(command);
    if (!response.Body) throw new Error("Empty body from S3");
    return await response.Body.transformToString();
  } catch (error: any) {
    console.error(`Error fetching from S3 [${bucket}/${key}]:`, error.message);
    throw error;
  }
}
