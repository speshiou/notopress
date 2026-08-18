import { NextRequest, NextResponse } from "next/server";
import { GetObjectCommand, type GetObjectCommandOutput } from "@aws-sdk/client-s3";
import { getS3Client } from "@/lib/s3";
import { env } from "@/lib/env";

import { getContentType } from "@/lib/content-types";

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
    const client = getS3Client();
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
        "Content-Disposition": "inline",
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
