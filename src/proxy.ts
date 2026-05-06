import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
  // If the API route redirects back here with ?fallback=true, we skip the vault rewrite.
  if (url.searchParams.get('fallback') === 'true') {
    return NextResponse.next();
  }

  // 3. Check if the path looks like a static file (has an extension)
  const hasExtension = pathname.includes('.') && !pathname.endsWith('/');
  if (!hasExtension) {
    return NextResponse.next();
  }

  // 4. Normalize path for matching (remove leading slash)
  const filePath = pathname.slice(1);

  // 5. Blind rewrite to vault-public API route
  // Local files in /public/ are served by Next.js before middleware (if configured)
  // or will result in a 404 (or fallback redirect) from the API route if not in S3.
  return NextResponse.rewrite(new URL(`/api/vault-public/${filePath}`, request.url));
}

export const config = {
  // Apply middleware to all paths except those that clearly shouldn't be matched
  matcher: '/((?!_next/static|_next/image).*)',
};
