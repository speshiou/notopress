import { notFound } from "next/navigation";
import { fetchPageMetadata } from "@/lib/notion";
import NotionPage from "@/components/server/notion-page"; // Updated import path

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  try {
    const data = await fetchPageMetadata({ pageId: id });
    const { Name } = data.properties;

    // Ensure Name property and title array exist and have elements
    const pageTitle = (Name.type === "title" && Name.title[0]?.plain_text) ? Name.title[0].plain_text : "Untitled";

    return {
      title: pageTitle,
      // description: content, // Consider adding description from page properties if available
    };
  } catch (error) {
    console.error(`Error generating metadata for page ${id}:`, error);
    // Return a generic error title or handle as appropriate
    // Depending on requirements, you might want to re-throw or call notFound()
    return {
      title: "Page Not Found",
      description: "Could not fetch the page content.",
    };
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The fetchPageBlocks and block rendering logic is now handled by NotionPage component.
  // The NotionPage component also handles loading and error states.
  // If the page itself (metadata) can't be fetched, generateMetadata would ideally handle notFound,
  // or we might need a check here if fetchPageMetadata could indicate a 404.
  // For now, we assume if metadata is fetched, the page exists, and NotionPage will handle block fetching.

  return (
    <div className="flex flex-col gap-4">
      <NotionPage pageId={id} />
    </div>
  );
}
