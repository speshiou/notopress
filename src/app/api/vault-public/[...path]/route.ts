import { NextRequest, NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getRegistry } from "@/lib/registry";
import { env } from "@/lib/env";

/**
 * Maps common file extensions to Content-Type headers.
 */
function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "svg": return "image/svg+xml";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    case "txt": return "text/plain";
    case "css": return "text/css";
    case "js": return "application/javascript";
    case "json": return "application/json";
    default: return "application/octet-stream";
  }
}

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
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathArray } = await params;
  const filePath = pathArray.join("/");
  const vaultRoot = env.VAULT_ROOT;
  const bucketName = env.S3_BUCKET;

  if (!vaultRoot || !bucketName) {
    return new NextResponse("Site configuration missing", { status: 500 });
  }

  try {
    const client = await getS3Client();
    const key = `${vaultRoot}/public/${filePath}`;

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);

    if (!response.Body) {
      return new NextResponse("Not Found", { status: 404 });
    }

    // Convert the stream to a Response
    const stream = response.Body as ReadableStream;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": getContentType(filePath),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error: any) {
    console.error(`Error serving vault public file [${filePath}]:`, error.message);
    return new NextResponse("Not Found", { status: 404 });
  }
}
