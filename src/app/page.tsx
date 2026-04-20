import { headers } from "next/headers";
import { getSiteByDomain, getRegistry } from "@/lib/registry";
import { getFileFromS3 } from "@/lib/s3";
import { remark } from "remark";
import html from "remark-html";

export default async function Home() {
  const host = (await headers()).get("host") || "localhost:3000";
  // For local development, allow overriding via env
  const siteId = process.env.LOCAL_SITE_ID;
  
  let site;
  if (siteId) {
    const registry = await getRegistry();
    site = registry.sites.find(s => s.siteId === siteId);
  } else {
    site = await getSiteByDomain(host);
  }

  // Fallback to first site if none matched in development
  if (!site && process.env.NODE_ENV === 'development') {
    try {
      const registry = await getRegistry();
      site = registry.sites[0];
    } catch {
      // Registry might not even load
    }
  }

  if (!site) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 tracking-tight">Site Not Found</h1>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            We couldn't find a site matching <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-900 rounded border border-zinc-200 dark:border-zinc-800 text-sm font-mono">{host}</code> in our registry.
          </p>
        </div>
      </div>
    );
  }

  if (!site.bucketName) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 tracking-tight">Configuration Missing</h1>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
            The site <strong className="text-zinc-900 dark:text-zinc-200">{site.siteId}</strong> is registered but has no <code className="text-sm font-mono">bucketName</code> configured.
          </p>
        </div>
      </div>
    );
  }

  try {
    const markdown = await getFileFromS3(site.bucketName, `${site.siteId}/index.md`);
    const processedContent = await remark().use(html).process(markdown);
    const contentHtml = processedContent.toString();

    return (
      <div className="flex flex-col min-h-screen bg-white dark:bg-black selection:bg-zinc-200 dark:selection:bg-zinc-800 transition-colors duration-500">
        <main className="flex-1 max-w-3xl mx-auto w-full py-24 px-8 md:px-12 animate-in fade-in slide-in-from-bottom-4 duration-1000 ease-out">
          <article 
            className="prose prose-zinc dark:prose-invert prose-lg max-w-none 
              prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100
              prose-p:leading-8 prose-p:text-zinc-600 dark:prose-p:text-zinc-400
              prose-a:font-medium prose-a:text-zinc-900 dark:prose-a:text-zinc-100 prose-a:underline-offset-4 prose-a:decoration-zinc-300 dark:prose-a:decoration-zinc-700 hover:prose-a:decoration-zinc-900 dark:hover:prose-a:decoration-zinc-300 transition-all
              prose-pre:bg-zinc-50/50 dark:prose-pre:bg-zinc-900/30 prose-pre:border prose-pre:border-zinc-200/60 dark:prose-pre:border-zinc-800/60 prose-pre:rounded-2xl
              prose-code:text-zinc-800 dark:prose-code:text-zinc-300 prose-code:bg-zinc-100 dark:prose-code:bg-zinc-900/50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none
              prose-img:rounded-3xl prose-img:shadow-2xl prose-img:mx-auto prose-img:border prose-img:border-zinc-100 dark:prose-img:border-zinc-800
              prose-hr:border-zinc-100 dark:prose-hr:border-zinc-900"
            dangerouslySetInnerHTML={{ __html: contentHtml }} 
          />
        </main>
        
        <footer className="max-w-3xl mx-auto w-full py-16 px-8 border-t border-zinc-100 dark:border-zinc-900 text-sm font-medium">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 text-zinc-400 dark:text-zinc-500">
            <p>© {new Date().getFullYear()} • {site.domain}</p>
            <div className="flex items-center gap-2">
              <span>Published with</span>
              <a href="https://github.com/speshiou/notopress" className="text-zinc-900 dark:text-zinc-300 hover:opacity-70 transition-opacity">Notopress</a>
            </div>
          </div>
        </footer>
      </div>
    );
  } catch (error: any) {
    const isNotFound = error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404;
    
    return (
       <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 tracking-tight">
            {isNotFound ? "No Home Page Yet" : "Content Error"}
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-6">
            {isNotFound 
              ? `We couldn't find an index.md file in the vault for ${site.siteId}. Please run npm run sync after creating it.`
              : `Failed to load home page content: ${error.message}`}
          </p>
          {isNotFound && (
            <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 text-xs font-mono text-zinc-500 dark:text-zinc-400">
              Expected at: {site.bucketName}/{site.siteId}/index.md
            </div>
          )}
        </div>
      </div>
    );
  }
}
