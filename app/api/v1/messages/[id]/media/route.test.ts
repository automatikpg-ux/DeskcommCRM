import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { GET } from "./route";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(), resolveActiveOrg: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const org = "11111111-1111-4111-8111-111111111111";
const msgId = "22222222-2222-4222-8222-222222222222";
const signedUrl = "https://projeto.supabase.co/storage/v1/object/sign/whatsapp-media/a.jpg?token=t";
const ctx = { params: Promise.resolve({ id: msgId }) };
const req = (headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost/api/v1/messages/${msgId}/media`, { headers });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(loadAuthUser).mockResolvedValue({ id: "u", idioma: "pt-BR" } as Awaited<ReturnType<typeof loadAuthUser>>);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: org } as Awaited<ReturnType<typeof resolveActiveOrg>>);
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({
      data: { id: msgId, media_url: null, media_mime: "image/jpeg", media_storage_path: `${org}/c/a.jpg`, channel_session_id: null },
      error: null,
    }),
  };
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "u" } }, error: null }) },
    from: () => query,
  } as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(createAdminClient).mockReturnValue({
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl }, error: null }) }) },
  } as unknown as ReturnType<typeof createAdminClient>);
});

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/v1/messages/[id]/media — mídia persistida", () => {
  it("serve os bytes pela URL estável com cache immutable do navegador (não mais 302 sem cache)", async () => {
    fetchMock.mockResolvedValue(new Response("JPEG", { status: 200, headers: { "content-type": "image/jpeg", "content-length": "4" } }));
    const res = await GET(req(), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(await res.text()).toBe("JPEG");
    expect(fetchMock).toHaveBeenCalledWith(signedUrl, { headers: undefined });
  });

  it("repassa Range e devolve 206 para áudio/vídeo", async () => {
    fetchMock.mockResolvedValue(new Response("AB", { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-1/10" } }));
    const res = await GET(req({ range: "bytes=0-1" }), ctx);
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/10");
    expect(fetchMock).toHaveBeenCalledWith(signedUrl, { headers: { Range: "bytes=0-1" } });
  });

  it("se o Storage falhar, cai no 302 antigo em vez de quebrar a mídia", async () => {
    fetchMock.mockRejectedValue(new Error("rede"));
    const res = await GET(req(), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(signedUrl);
  });
});
