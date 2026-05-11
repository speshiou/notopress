import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getRegistry } from "@/lib/registry";
import { env } from "@/lib/env";

let s3Client: S3Client | null = null;

async function getS3Client() {
  if (s3Client) return s3Client;

  const registry = await getRegistry();
  const endpoint = registry.endpoint || env.S3_ENDPOINT;
  const accessKeyId = registry.accessKeyId || env.S3_ACCESS_KEY_ID;
  const secretAccessKey = registry.secretAccessKey || env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3 credentials.");
  }

  s3Client = new S3Client({
    endpoint,
    region: "auto",
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  return s3Client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path: pathArray } = await params;
  const filePath = pathArray?.join("/") || "sitemap.xml";
  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    return new NextResponse("Site configuration missing", { status: 500 });
  }

  try {
    const client = await getS3Client();
    const key = `${vaultRoot}/${filePath}`;

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      return new NextResponse("Not Found", { status: 404 });
    }

    // Use a custom ReadableStream to return the body
    const body = response.Body as any;

    return new NextResponse(body.transformToWebStream(), {
      headers: {
        "Content-Type": "text/xml",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error: any) {
    console.error(`Error serving sitemap [${filePath}]:`, error.message);
    return new NextResponse("Not Found", { status: 404 });
  }
}
