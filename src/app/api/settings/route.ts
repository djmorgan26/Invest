import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";

/**
 * GET: Read a setting by key
 * POST: Update a setting (body: { key, value })
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const supabase = createServerClient();
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", key)
    .single();

  return NextResponse.json({ key, value: data?.value ?? null });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { key, value } = body;

  if (!key) return NextResponse.json({ error: "Missing key" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ key, value, updated: true });
}
