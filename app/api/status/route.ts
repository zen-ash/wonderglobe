import { getServiceStatus } from "@/server/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET → ServiceStatus (booleans only; never secrets). */
export function GET(): Response {
  return Response.json(getServiceStatus(), { headers: { "Cache-Control": "no-store" } });
}
