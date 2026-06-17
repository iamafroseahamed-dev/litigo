import { serve } from 'https://deno.land/std@0.205.0/http/server.ts';
import * as pdfjsLib from 'https://esm.sh/pdfjs-dist@3.11.122/build/pdf.js';

interface RequestPayload {
  pdf_url: string;
  filename: string;
}

function textContentToString(content: any) {
  return content.items?.map((item: any) => item.str ?? '').join(' ') ?? '';
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    });
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { pdf_url, filename } = payload;
  if (!pdf_url || !filename) {
    return new Response(JSON.stringify({ message: 'pdf_url and filename are required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const response = await fetch(pdf_url);
    if (!response.ok) {
      return new Response(JSON.stringify({ message: 'Unable to download PDF', status: response.status }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDocument = await loadingTask.promise;
    const pageCount = pdfDocument.numPages;

    let extractedText = '';
    for (let pageIndex = 1; pageIndex <= pageCount; pageIndex += 1) {
      const page = await pdfDocument.getPage(pageIndex);
      const textContent = await page.getTextContent();
      extractedText += textContentToString(textContent) + '\n\n';
    }

    return new Response(JSON.stringify({ text: extractedText.trim() }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    console.error('extract-judgment-text failed', error);
    return new Response(JSON.stringify({ message: 'Unable to extract text from PDF' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
});
