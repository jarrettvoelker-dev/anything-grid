import { useEffect, useState } from "react";

/* 极简路由：三条路径，不值得引 react-router。
   用 History API 而不是 hash，是为了拿到规格要求的 /grid/:id 这种干净链接。 */

export type Route =
  | { name: "home" }
  | { name: "new" }
  | { name: "play"; id: string }
  | { name: "edit"; id: string }
  | { name: "notfound"; path: string };

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function parse(path: string): Route {
  const p = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const seg = p.split("/").filter(Boolean);
  if (!seg.length) return { name: "home" };
  if (seg[0] === "new") return { name: "new" };
  if (seg[0] === "grid" && seg[1]) {
    return seg[2] === "edit" ? { name: "edit", id: seg[1] } : { name: "play", id: seg[1] };
  }
  return { name: "notfound", path };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}

export function navigate(to: string, replace = false) {
  const url = BASE + to;
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export const gridUrl = (id: string) => `${location.origin}${BASE}/grid/${id}`;
