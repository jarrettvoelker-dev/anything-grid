import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* 构建后处理：
   1. 生成 404.html —— GitHub Pages 是纯静态托管，直接访问 /grid/:id 会 404。
      把原路径塞进 ?p= 交给 index.html 还原（还原逻辑写在 index.html 的 head 里）。
      Cloudflare Worker（M2）有真正的路由，不会走到这个文件。
   2. 生成 .nojekyll —— 否则 Pages 会拿 Jekyll 处理，下划线开头的资源目录会被吞掉。 */

const dist = join(process.cwd(), "dist");
const base = (process.env.VITE_BASE ?? "/").replace(/\/$/, "");
const index = readFileSync(join(dist, "index.html"), "utf8");

const redirect = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Anything Grid</title>
    <script>
      /* SPA 兜底：把打不开的路径原样带给入口页，由它还原成真实路由 */
      var p = location.pathname + location.search + location.hash;
      location.replace(${JSON.stringify(base + "/")} + "?p=" + encodeURIComponent(p));
    </script>
  </head>
  <body></body>
</html>
`;

writeFileSync(join(dist, "404.html"), redirect);
writeFileSync(join(dist, ".nojekyll"), "");
writeFileSync(join(dist, "index.html"), index);
console.log(`postbuild: 404.html + .nojekyll 已生成（base=${base || "/"}）`);
