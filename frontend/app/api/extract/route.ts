import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // important for File/FormData support

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('pdf') as File | null; // <-- matches your client pages
    if (!file) {
      return NextResponse.json({ error: 'Missing file field "pdf"' }, { status: 400 });
    }

    const backend = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

    // forward as multipart/form-data with the SAME field name your FastAPI expects
    const fd = new FormData();
    fd.append('pdf', file, file.name);

    const res = await fetch(`${backend}/extract`, {
      method: 'POST',
      body: fd,
    });

    // try to parse backend JSON
    const data = await res.json().catch(() => ({ detail: 'Invalid JSON from backend' }));

    if (!res.ok) {
      // normalize error shape to what your pages expect
      const msg = (data?.detail && typeof data.detail === 'string')
        ? data.detail
        : (data?.detail?.message || data?.error || 'Extraction failed at backend');
      return NextResponse.json({ error: msg }, { status: res.status });
    }

    // Keep your current pages contract: { success: true, data }
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Proxy error' }, { status: 500 });
  }
}
