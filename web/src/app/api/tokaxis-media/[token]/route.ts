import type { NextRequest } from "next/server";

import { readTemporaryMedia } from "../../../../lib/temporary-media.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{ token: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
    const { token } = await context.params;
    const media = await readTemporaryMedia(token);
    if (!media) return Response.json({ error: { message: "参考素材已过期或不存在" } }, { status: 404 });
    return new Response(new Uint8Array(media.content), {
        headers: {
            "Cache-Control": "public, max-age=900",
            "Content-Length": String(media.content.byteLength),
            "Content-Type": media.mimeType,
            "Content-Security-Policy": "default-src 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
