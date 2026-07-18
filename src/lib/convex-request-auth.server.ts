import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export async function authenticateConvexRequest(request: Request) {
  const authHeader = request.headers.get("authorization");
  const convexUrl = process.env.VITE_CONVEX_URL;
  if (!authHeader?.startsWith("Bearer ") || !convexUrl) return null;

  const convex = new ConvexHttpClient(convexUrl);
  convex.setAuth(authHeader.slice("Bearer ".length));
  const user = await convex.query(api.auth.getCurrentUser);
  if (!user || typeof user.id !== "string" || user.id.length === 0) return null;
  return { convex, ownerId: user.id };
}
