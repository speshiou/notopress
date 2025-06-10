This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Webhook for Route Invalidation

This project includes a webhook endpoint to allow external systems to trigger route invalidation when page content changes in the headless CMS (e.g., Notion). This ensures that the application serves the most up-to-date content without requiring a manual rebuild or redeployment.

### Endpoint

*   **URL:** `/api/revalidate`
*   **Method:** `POST`

### Security

The webhook is secured using a secret token.
1.  **Set Environment Variable:** Add `WEBHOOK_SECRET_TOKEN` to your `.env.local` file and your deployment environment variables. Choose a strong, unique string for this token.
    ```
    WEBHOOK_SECRET_TOKEN="your_strong_secret_token_here"
    ```
2.  **Authorization Header:** Incoming webhook requests must include an `Authorization` header with a Bearer token:
    ```
    Authorization: Bearer <your_strong_secret_token_here>
    ```
    Requests without a valid token will be rejected with a `401 Unauthorized` error.

### Request Payload

The webhook expects a JSON payload with the following structure:

```json
{
  "event_type": "page_created" | "page_updated" | "page_deleted",
  "page_id": "string"
}
```

*   `event_type` (required): Specifies the type of page event.
    *   `page_created`: When a new page has been created.
    *   `page_updated`: When an existing page has been modified.
    *   `page_deleted`: When a page has been deleted.
*   `page_id` (required): The unique identifier of the page that was affected (e.g., the Notion page ID).

### Behavior

Upon receiving a valid and authorized webhook request:

*   For `page_created` and `page_updated` events, the application will invalidate the cache for the corresponding page route (e.g., `/post/<page_id>`). The next time this page is requested, it will be re-rendered with the latest content.
*   For `page_deleted` events, the application will attempt to revalidate the path. If the page has been removed from the CMS, subsequent requests to this path should result in a 404 (Not Found) page.

This ensures that changes made in the CMS are reflected in the application automatically.
