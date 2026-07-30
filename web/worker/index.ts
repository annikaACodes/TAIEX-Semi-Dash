/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DATA?: R2Bucket;
  DASHBOARD_SYNC_TOKEN?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const DASHBOARD_BUNDLE_KEY = "dashboard-bundle.json.gz";

function dashboardBundleHeaders(source?: Headers) {
  const headers = new Headers(source);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Content-Encoding", "gzip");
  headers.set("Cache-Control", "no-cache, must-revalidate");
  headers.set("Vary", "Accept-Encoding");
  return headers;
}

async function serveDashboardBundle(request: Request, env: Env) {
  const storedBundle = await env.DATA?.get(DASHBOARD_BUNDLE_KEY);
  if (storedBundle) {
    const headers = dashboardBundleHeaders();
    storedBundle.writeHttpMetadata(headers);
    headers.set("ETag", storedBundle.httpEtag);
    return new Response(storedBundle.body, { headers });
  }

  const assetUrl = new URL(`/data/${DASHBOARD_BUNDLE_KEY}`, request.url);
  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers: dashboardBundleHeaders(assetResponse.headers),
  });
}

async function updateDashboardBundle(request: Request, env: Env) {
  if (
    !env.DASHBOARD_SYNC_TOKEN ||
    request.headers.get("Authorization") !==
      `Bearer ${env.DASHBOARD_SYNC_TOKEN}`
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!env.DATA) {
    return Response.json(
      { error: "Dashboard storage is unavailable" },
      { status: 503 },
    );
  }
  if (!request.body) {
    return Response.json({ error: "Missing dashboard bundle" }, { status: 400 });
  }
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > 10_000_000) {
    return Response.json({ error: "Dashboard bundle is too large" }, { status: 413 });
  }

  await env.DATA.put(DASHBOARD_BUNDLE_KEY, request.body, {
    httpMetadata: {
      contentType: "application/json; charset=utf-8",
      contentEncoding: "gzip",
    },
  });
  return Response.json({ updated: true });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/dashboard-bundle") {
      if (request.method === "GET" || request.method === "HEAD") {
        return serveDashboardBundle(request, env);
      }
      if (request.method === "PUT") {
        return updateDashboardBundle(request, env);
      }
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD, PUT" },
      });
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
