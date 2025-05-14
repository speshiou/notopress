import { Client, isFullPage } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_INTEGRATION_SECRET });

export async function fetchDatabase(databaseId: string) {
  try {
    const response = await notion.databases.query({ database_id: databaseId });
    return response.results;
  } catch (error) {
    console.error("Error reading Notion database:", error);
    throw error;
  }
}

export async function fetchPageMetadata({ pageId }: { pageId: string }) {
  console.log("Fetching page content for ID:", pageId);
  try {
    const response = await notion.pages.retrieve({
      page_id: pageId,
    });
    if (!isFullPage(response)) {
      throw new Error("Response is not a full page object");
    }
    return response;
  } catch (error) {
    console.error("Error retrieving Notion page content:", error);
    throw error;
  }
}

// Fetch a page's block content
export async function fetchPageBlocks({ pageId }: { pageId: string }) {
  // TODO: Handle pagination if there are more than 100 blocks
  const response = await notion.blocks.children.list({
    block_id: pageId,
    page_size: 100,
  });
  return response.results;
}
