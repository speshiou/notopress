import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getVaultIndex } from '@/lib/vault';

export async function middleware(request: NextRequest) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // 1. Skip internal Next.js paths and API routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next();
  }

  // 2. Check if the path looks like a static file (has an extension)
  const hasExtension = pathname.includes('.') && !pathname.endsWith('/');
  if (!hasExtension) {
    return NextResponse.next();
  }

  // 3. Normalize path for matching (remove leading slash)
  const filePath = pathname.slice(1);

  // 4. Check if the file exists in the vault's public directory
  try {
    const index = await getVaultIndex();
    if (index && index.publicFiles && index.publicFiles.includes(filePath)) {
      // Rewrite to the vault-public API route
      return NextResponse.rewrite(new URL(`/api/vault-public/${filePath}`, request.url));
    }
  } catch (error) {
    // If we fail to check the index, we just proceed
    console.error('Middleware: Failed to check vault index:', error);
  }

  // 5. Fallback to native public dir or other routes
  return NextResponse.next();
}

export const config = {
  // Apply middleware to all paths except those that clearly shouldn't be matched
  // But we handle specific exclusions inside the middleware for finer control.
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
