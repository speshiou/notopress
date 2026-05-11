import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchRootIndex } from './lib/vault';
import { env } from './lib/env';

export async function proxy(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Skip internal Next.js paths and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api')
  ) {
    return NextResponse.next();
  }

  // 2. Handle fallback for system files like favicon.ico
  if (url.searchParams.get('fallback') === 'true') {
    return NextResponse.next();
  }

  // 3. Handle sitemap.xml and sitemap_pages.xml
  if (pathname === '/sitemap.xml' || pathname === '/sitemap_pages.xml') {
    return NextResponse.rewrite(new URL(`/api/sitemap${pathname}`, request.url));
  }

  // 4. Handle nested sitemap.xml (e.g., /dir/sitemap.xml -> /api/sitemap/content/dir/sitemap.xml)
  if (pathname.endsWith('/sitemap.xml')) {
    const dirPath = pathname.slice(1, -'sitemap.xml'.length);
    return NextResponse.rewrite(new URL(`/api/sitemap/content/${dirPath}sitemap.xml`, request.url));
  }

  // 5. Check if the path looks like a static file (has an extension)
  const hasExtension = pathname.includes('.') && !pathname.endsWith('/');
  if (hasExtension) {
    const filePath = pathname.slice(1);
    return NextResponse.rewrite(new URL(`/api/vault-public/${filePath}`, request.url));
  }

  // 6. Check if it's a public file without extension (from root.json)
  const vaultConfig = {
    bucketName: env.S3_BUCKET!,
    vaultRoot: env.VAULT_ROOT!,
  };

  if (vaultConfig.bucketName && vaultConfig.vaultRoot) {
    const rootIndex = await fetchRootIndex(vaultConfig);
    const filePath = pathname.slice(1);
    if (rootIndex?.publicFiles.includes(filePath)) {
      return NextResponse.rewrite(new URL(`/api/vault-public/${filePath}`, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Apply middleware to all paths except those that clearly shouldn't be matched
  matcher: '/((?!_next/static|_next/image).*)',
};
