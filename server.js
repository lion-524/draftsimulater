import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT) || 3000;
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const csvPath = process.env.DRAFT_CSV_PATH || path.join(rootDir, "坂道ドラフト - シート1.csv");

app.disable("x-powered-by");
const publicFiles = new Map([
  ["index.html", "index.html"],
  ["rules.html", "rules.html"],
  ["style.css", "style.css"],
  ["app.js", "app.js"],
  ["members.csv", "坂道ドラフト - シート1.csv"],
  ["html2canvas.min.js", "node_modules/html2canvas/dist/html2canvas.min.js"]
]);

app.get(/\/$/, (req, res) => res.sendFile(path.join(rootDir, "index.html")));
app.get(/\/(index\.html|rules\.html|style\.css|app\.js|members\.csv|html2canvas\.min\.js)$/, (req, res) => {
  const filename = publicFiles.get(path.basename(req.path));
  if (!filename) return res.sendStatus(404);
  res.sendFile(path.join(rootDir, filename));
});

app.listen(port, () => {
  console.log(`Draftsimulater listening at http://localhost:${port}`);
});