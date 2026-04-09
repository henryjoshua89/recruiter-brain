import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import type { CompanyContextPayload } from "@/lib/types";

function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readMeta(html: string, key: string): string {
  const direct = new RegExp(
    `<meta[^>]+name=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  ).exec(html);
  if (direct?.[1]) return direct[1].trim();

  const property = new RegExp(
    `<meta[^>]+property=["']${key}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    "i"
  ).exec(html);
  return property?.[1]?.trim() ?? "";
}

/** Reverse-order content attribute meta tags (common on modern sites). */
function readMetaContentLast(html: string, key: string): string {
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["'][^>]*>`,
    "i"
  ).exec(html);
  return contentFirst?.[1]?.trim() ?? "";
}

function readMetaAny(html: string, key: string): string {
  return readMeta(html, key) || readMetaContentLast(html, key);
}

function removeScriptsStylesAndSvg(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ");
}

function extractVisibleText(html: string, maxChars: number): string {
  const cleaned = removeScriptsStylesAndSvg(html);
  let text = stripHtmlTags(cleaned);
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trim() + " …";
}

function extractHeadings(html: string, max: number): string[] {
  const out: string[] = [];
  const re = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < max) {
    const t = stripHtmlTags(m[1]);
    if (t.length > 0 && t.length < 500) out.push(t);
  }
  return out;
}

const MAX_EXTRACTED_TEXT_CHARS = 38_000;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CompanyContextPayload;
    const companyName = body.companyName?.trim();
    const websiteUrl = normalizeWebsiteUrl(body.websiteUrl ?? "");

    if (!companyName || !websiteUrl) {
      return NextResponse.json(
        { error: "Company name and website URL are required." },
        { status: 400 }
      );
    }

    const websiteResponse = await fetch(websiteUrl, {
      headers: {
        "User-Agent": "RecruiterBrainBot/1.0",
      },
    });

    if (!websiteResponse.ok) {
      return NextResponse.json(
        { error: "Could not fetch company website." },
        { status: 400 }
      );
    }

    const html = await websiteResponse.text();
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? stripHtmlTags(titleMatch[1]) : "";
    const metaDescription =
      readMetaAny(html, "description") ||
      readMetaAny(html, "og:description") ||
      readMetaAny(html, "twitter:description");
    const ogTitle = readMetaAny(html, "og:title");
    const extractedPageText = extractVisibleText(html, MAX_EXTRACTED_TEXT_CHARS);
    const headings = extractHeadings(html, 40);

    const summary = [
      title,
      metaDescription,
      headings.slice(0, 3).join(" · "),
    ]
      .filter(Boolean)
      .join(" — ")
      .slice(0, 1200);

    const publicContext = {
      title,
      metaDescription,
      ogTitle: ogTitle || undefined,
      summary,
      headings,
      extractedPageText,
      extractedTextLength: extractedPageText.length,
      sourceUrl: websiteUrl,
      fetchedAt: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("companies")
      .upsert(
        {
          name: companyName,
          website_url: websiteUrl,
          public_context: publicContext,
        },
        {
          onConflict: "website_url",
        }
      )
      .select("id, name, website_url, public_context")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Failed to store company details.", details: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      company: {
        id: data.id,
        name: data.name,
        websiteUrl: data.website_url,
        publicContext: data.public_context,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
