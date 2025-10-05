export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { item } = body;
    // For POC, just echo the item as "transformed"
    // (You can add real mapping logic later)
    return new Response(JSON.stringify({ ...item, transformed: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), { status: 500 });
  }
}
