import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";
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
    const candidateKeys = [`${vaultRoot}/public/${filePath}`, `${vaultRoot}/content/${filePath}`];
    let response: GetObjectCommandOutput | null = null;

    for (const key of candidateKeys) {
      try {
        response = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
        break;
      } catch {
        response = null;
      }
    }

    if (!response || !response.Body) {
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
  } catch (error: unknown) {
    // Fallback logic for critical system files like favicon.ico
    if (filePath === "favicon.ico") {
      const url = new URL(_request.url);
      url.pathname = "/favicon.ico";
      url.searchParams.set("fallback", "true");
      return NextResponse.redirect(url);
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error serving vault public file [${filePath}]:`, message);
    return new NextResponse("Not Found", { status: 404 });
  }
}
