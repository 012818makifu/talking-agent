import { createHash, timingSafeEqual } from "node:crypto";
import { clientIp, rateLimit } from "./safety";

export function checkMapAccess(req: Request) {
  const secret = process.env.CHILD_MAP_ADMIN_PASSWORD;
  const supplied = req.headers.get("x-map-password") || "";
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!secret || !supplied || !timingSafeEqual(digest(secret), digest(supplied)))
    return Response.json({ error: "管理密碼未設定或不正確。免費示範仍可使用。" }, { status: 403 });
  if (!rateLimit("map-live:" + clientIp(req), 3).ok)
    return Response.json({ error: "請稍等一分鐘再試。" }, { status: 429 });
}
