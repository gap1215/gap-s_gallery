import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    // IMPORTANT: Supabase stores new secret keys in a named JSON dictionary.
    // The project's normal key is under "default".
    const secretKey = secretKeys["default"] as string | undefined;

    if (!supabaseUrl || !secretKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEYS.default");
      return json({ error: "Server configuration error" }, 500);
    }

    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });

    const body = await req.json();
    const albumId = body.albumId as string | undefined;
    const password = body.password as string | undefined;
    const token = body.token as string | undefined;
    if (!albumId) return json({ error: "albumId is required" }, 400);

    const { data: album, error: albumError } = await admin
      .from("albums")
      .select("id,name,access_type,cover_url")
      .eq("id", albumId)
      .maybeSingle();

    if (albumError) {
      console.error("album lookup failed", albumError);
      return json({ error: "Could not load album" }, 500);
    }
    if (!album) return json({ error: "Album not found" }, 404);

    let allowed = album.access_type === "public";

    if (album.access_type === "password") {
      if (!password) return json({ allowed: false, requiresPassword: true }, 401);
      const { data: passwordOk, error: passwordError } = await admin.rpc(
        "check_album_password",
        { target_album_id: albumId, supplied_password: password },
      );
      if (passwordError) {
        console.error("password check failed", passwordError);
        return json({ error: "Password check failed" }, 500);
      }
      allowed = passwordOk === true;
    }

    if (album.access_type === "link") {
      if (!token) return json({ allowed: false }, 403);
      const { data: tokenOk, error: tokenError } = await admin.rpc(
        "check_album_share_token",
        { target_album_id: albumId, supplied_token: token },
      );
      if (tokenError) {
        console.error("link check failed", tokenError);
        return json({ error: "Link check failed" }, 500);
      }
      allowed = tokenOk === true;
    }

    if (!allowed) return json({ allowed: false }, 403);

    const { data: photos, error: photosError } = await admin
      .from("photos")
      .select("id,storage_path,preview_path,sort_order")
      .eq("album_id", albumId)
      .order("sort_order", { ascending: true });
    if (photosError) {
      console.error("photo lookup failed", photosError);
      return json({ error: "Could not load photos" }, 500);
    }

    const result = [];
    for (const photo of photos ?? []) {
      const { data: signed, error: signedError } = await admin.storage
        .from("photos")
        .createSignedUrl(photo.storage_path, 86400);
      if (!signedError && signed?.signedUrl) {
        let previewUrl: string | null = null;
        if (photo.preview_path) {
          const { data: previewSigned, error: previewError } = await admin.storage
            .from("photos")
            .createSignedUrl(photo.preview_path, 86400);
          if (!previewError && previewSigned?.signedUrl) previewUrl = previewSigned.signedUrl;
        }
        result.push({
          id: photo.id,
          url: signed.signedUrl,
          previewUrl,
          sortOrder: photo.sort_order,
        });
      }
    }

    return json({
      allowed: true,
      album: { id: album.id, name: album.name, access: album.access_type },
      photos: result,
    });
  } catch (error) {
    console.error(error);
    return json({ error: "Unexpected server error" }, 500);
  }
});
