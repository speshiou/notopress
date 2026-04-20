import { resolveVaultRequest } from "@/lib/vault";
import { env } from "@/lib/env";
import { INDEX_SLUG } from "@/lib/constants";
import { remark } from "remark";
import html from "remark-html";
import Link from "next/link";
import { notFound } from "next/navigation";

export default async function DynamicPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug: slugArray } = await params;
  const vaultRoot = env.VAULT_ROOT;

  try {
    const result = await resolveVaultRequest(slugArray);

    // 1. Render matched Markdown file
    if (result.type === "markdown") {
      const processedContent = await remark().use(html).process(result.content);
      const contentHtml = processedContent.toString();

      return (
        <div className="flex flex-col min-h-screen bg-white dark:bg-black selection:bg-zinc-200 dark:selection:bg-zinc-800 transition-colors duration-500">
          <main className="flex-1 max-w-3xl mx-auto w-full py-24 px-8 md:px-12 animate-in fade-in slide-in-from-bottom-4 duration-1000 ease-out">
            <nav className="mb-12">
              <Link href="/" className="text-sm font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">
                ← Home
              </Link>
            </nav>
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
          <Footer vaultRoot={vaultRoot || ""} />
        </div>
      );
    }

    // 2. Render Collection View (folder listing)
    if (result.type === "collection") {
      return (
        <div className="flex flex-col min-h-screen bg-white dark:bg-black selection:bg-zinc-200 dark:selection:bg-zinc-800 transition-colors duration-500">
          <main className="flex-1 max-w-3xl mx-auto w-full py-24 px-8 md:px-12 animate-in fade-in duration-700">
            <header className="mb-20">
              {result.requestedSlug !== INDEX_SLUG && (
                <nav className="mb-12">
                  <Link href="/" className="text-sm font-medium text-zinc-400 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-200 transition-colors">
                    ← Home
                  </Link>
                </nav>
              )}
              <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-6 capitalize leading-tight">
                {result.requestedSlug === INDEX_SLUG ? "Archive" : result.requestedSlug.split("/").pop()}
              </h1>
              <p className="text-lg text-zinc-500 dark:text-zinc-400">
                Exploring thoughts in <code className="text-sm font-mono bg-zinc-50 dark:bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-100 dark:border-zinc-800">/{result.requestedSlug === INDEX_SLUG ? "" : result.requestedSlug}</code>
              </p>
            </header>

            <div className="grid gap-16">
              {result.posts.length > 0 ? (
                result.posts.map((post) => (
                  <Link key={post.slug} href={`/${post.slug}`} className="group block">
                    <article className="space-y-4">
                      <div className="flex items-center gap-3 text-xs font-bold tracking-widest uppercase text-zinc-400 dark:text-zinc-500">
                        <span>{new Date(post.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
                        <span className="w-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                        <span>{post.slug.split("/").length > 1 ? post.slug.split("/").slice(0, -1).join(" / ") : "Root"}</span>
                      </div>
                      <h2 className="text-3xl font-semibold text-zinc-800 dark:text-zinc-200 group-hover:text-zinc-500 dark:group-hover:text-zinc-400 transition-colors tracking-tight">
                        {post.title}
                      </h2>
                      {post.excerpt && (
                        <p className="text-lg text-zinc-500 dark:text-zinc-400 leading-relaxed line-clamp-3">
                          {post.excerpt}
                        </p>
                      )}
                      <div className="pt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100 group-hover:translate-x-1 transition-transform inline-flex items-center gap-2">
                        Read more <span className="text-zinc-300 dark:text-zinc-700">→</span>
                      </div>
                    </article>
                  </Link>
                ))
              ) : (
                <div className="py-24 text-center border-2 border-dashed border-zinc-100 dark:border-zinc-900 rounded-3xl">
                  <p className="text-zinc-400 dark:text-zinc-500 font-medium">No pages found in this directory.</p>
                </div>
              )}
            </div>
          </main>
          <Footer vaultRoot={vaultRoot || ""} />
        </div>
      );
    }
  } catch (error: any) {
    if (error.message === "Vault resource not found" || error.$metadata?.httpStatusCode === 404) {
      notFound();
    }
    throw error;
  }
}

function Footer({ vaultRoot }: { vaultRoot: string }) {
  return (
    <footer className="max-w-3xl mx-auto w-full py-20 px-8 border-t border-zinc-100 dark:border-zinc-900 text-sm font-medium">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-6 text-zinc-400 dark:text-zinc-500">
        <p className="tracking-tight">© {new Date().getFullYear()} • Published from vault <code className="text-xs font-mono ml-1">{vaultRoot}</code></p>
        <div className="flex items-center gap-2">
          <span>Built with</span>
          <a href="https://github.com/speshiou/notopress" className="text-zinc-900 dark:text-zinc-300 hover:opacity-70 transition-opacity underline decoration-zinc-200 dark:decoration-zinc-800 underline-offset-4">Notopress</a>
        </div>
      </div>
    </footer>
  );
}
