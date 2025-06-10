import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';

const WEBHOOK_SECRET_TOKEN = process.env.WEBHOOK_SECRET_TOKEN;

interface WebhookPayload {
  event_type: 'page_created' | 'page_updated' | 'page_deleted';
  page_id: string;
  // Add other relevant fields if necessary from the external system's webhook
}

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET_TOKEN) {
    console.error('WEBHOOK_SECRET_TOKEN is not set in environment variables.');
    return NextResponse.json({ message: 'Webhook misconfigured. Secret token not set.' }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return NextResponse.json({ message: 'Authorization header missing' }, { status: 401 });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || token !== WEBHOOK_SECRET_TOKEN) {
    return NextResponse.json({ message: 'Invalid token' }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ message: 'Invalid JSON payload' }, { status: 400 });
  }

  const { event_type, page_id } = payload;

  if (!event_type || !page_id) {
    return NextResponse.json({ message: 'Missing event_type or page_id in payload' }, { status: 400 });
  }

  const pathToRevalidate = `/post/${page_id}`;

  try {
    switch (event_type) {
      case 'page_created':
        console.log(`Received page_created event for page_id: ${page_id}. Revalidating ${pathToRevalidate}`);
        revalidatePath(pathToRevalidate);
        return NextResponse.json({ message: `Revalidated ${pathToRevalidate} for event: ${event_type}` });
      case 'page_updated':
        console.log(`Received page_updated event for page_id: ${page_id}. Revalidating ${pathToRevalidate}`);
        revalidatePath(pathToRevalidate);
        return NextResponse.json({ message: `Revalidated ${pathToRevalidate} for event: ${event_type}` });
      case 'page_deleted':
        console.log(`Received page_deleted event for page_id: ${page_id}. Revalidating ${pathToRevalidate}`);
        // Revalidating the path will cause Next.js to try to regenerate it.
        // If the page is deleted from Notion, the data fetching should fail, leading to a 404.
        revalidatePath(pathToRevalidate);
        return NextResponse.json({ message: `Path ${pathToRevalidate} revalidation triggered for event: ${event_type}` });
      default:
        console.log(`Received unknown event_type: ${event_type}`);
        return NextResponse.json({ message: 'Unknown event_type' }, { status: 400 });
    }
  } catch (err) {
    console.error(`Error revalidating path ${pathToRevalidate} for event ${event_type}:`, err);
    return NextResponse.json({ message: 'Error during revalidation' }, { status: 500 });
  }
}
