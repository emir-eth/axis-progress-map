import sharp from "sharp";
import path from "path";
import fs from "fs";

const dir = path.join(process.cwd(), "public", "assets");
const skills = [
  "pick",
  "place",
  "transfer",
  "stack",
  "open",
  "arrange",
  "rotate",
];

type Bounds = { x: number; y: number; w: number; h: number };

function analyze(
  data: Buffer,
  w: number,
  h: number,
  ch: number,
): {
  transparent: number;
  nearBlack: number;
  content: number;
  alphaBox: Bounds | null;
  contentBox: Bounds | null;
} {
  let minX = w,
    minY = h,
    maxX = -1,
    maxY = -1;
  let aMinX = w,
    aMinY = h,
    aMaxX = -1,
    aMaxY = -1;
  let transparent = 0,
    nearBlack = 0,
    content = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      if (a < 8) {
        transparent++;
        continue;
      }

      if (x < aMinX) aMinX = x;
      if (x > aMaxX) aMaxX = x;
      if (y < aMinY) aMinY = y;
      if (y > aMaxY) aMaxY = y;

      // Visible artwork vs solid black plate
      if (r + g + b > 36) {
        content++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        nearBlack++;
      }
    }
  }

  return {
    transparent,
    nearBlack,
    content,
    alphaBox:
      aMaxX >= 0
        ? { x: aMinX, y: aMinY, w: aMaxX - aMinX + 1, h: aMaxY - aMinY + 1 }
        : null,
    contentBox:
      maxX >= 0
        ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
        : null,
  };
}

async function main() {
  const report: unknown[] = [];

  for (const skill of skills) {
    const file = `axis-skill-${skill}.png`;
    const src = path.join(dir, file);
    const img = sharp(src);
    const meta = await img.metadata();
    const { data, info } = await img
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const canvas = info.width * info.height;
    const stats = analyze(data, info.width, info.height, info.channels);

    // Prefer alpha trim when meaningful transparent padding exists;
    // otherwise trim opaque black plate to content bounds.
    const transparentPct = (100 * stats.transparent) / canvas;
    const useAlpha =
      transparentPct > 5 &&
      stats.alphaBox &&
      (stats.alphaBox.w * stats.alphaBox.h) / canvas < 0.92;

    const box = useAlpha ? stats.alphaBox! : stats.contentBox!;
    if (!box) {
      console.error("No bounds for", file);
      continue;
    }

    const margin = Math.round(Math.max(box.w, box.h) * 0.03); // ~3%
    const left = Math.max(0, box.x - margin);
    const top = Math.max(0, box.y - margin);
    const right = Math.min(info.width, box.x + box.w + margin);
    const bottom = Math.min(info.height, box.y + box.h + margin);
    const extract = {
      left,
      top,
      width: right - left,
      height: bottom - top,
    };

    const outName = `axis-skill-${skill}-tight.png`;
    const outPath = path.join(dir, outName);

    // Extract artwork; convert solid black plate to transparent for light UI
    const extracted = await sharp(src)
      .ensureAlpha()
      .extract(extract)
      .raw()
      .toBuffer({ resolveWithObject: true });

    const outW = extracted.info.width;
    const outH = extracted.info.height;
    const outCh = extracted.info.channels;
    const out = Buffer.from(extracted.data);

    // Make near-black background transparent so the art sits cleanly on light UI
    for (let i = 0; i < out.length; i += outCh) {
      const r = out[i];
      const g = out[i + 1];
      const b = out[i + 2];
      const a = out[i + 3];
      if (a < 8) continue;
      if (r + g + b <= 36) {
        out[i + 3] = 0;
      }
    }

    await sharp(out, {
      raw: { width: outW, height: outH, channels: 4 },
    })
      .png()
      .toFile(outPath);

    const row = {
      file,
      original: { w: info.width, h: info.height, hasAlpha: !!meta.hasAlpha },
      transparentPct: +transparentPct.toFixed(1),
      nearBlackOpaquePct: +((100 * stats.nearBlack) / canvas).toFixed(1),
      contentPct: +((100 * stats.content) / canvas).toFixed(1),
      alphaBox: stats.alphaBox,
      contentBox: stats.contentBox,
      trimMode: useAlpha ? "alpha" : "content-on-black",
      extract,
      tight: { file: outName, w: outW, h: outH },
      contentFillOfOriginal: +(
        (100 * (box.w * box.h)) /
        canvas
      ).toFixed(1),
    };
    report.push(row);
    console.log(JSON.stringify(row, null, 2));
  }

  fs.writeFileSync(
    path.join(dir, "skill-trim-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log("\nWrote skill-trim-report.json and *-tight.png assets");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
