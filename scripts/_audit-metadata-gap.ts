import { fetchAxisTaskFamilies } from "../src/lib/axis";
import { buildTaskIndex } from "../src/lib/matcher";

async function main() {
  const addr = "0x1e30C7c5495a9248facbB3642AeE5DA0b8f75CAD";
  const res = await fetch("http://127.0.0.1:3010/api/profile/" + addr);
  const j = await res.json();
  const contribs = j.contributions as Array<{
    taskId: string;
    metadataStatus: string;
  }>;
  const families = await fetchAxisTaskFamilies({ forceRefresh: true });
  const index = buildTaskIndex(families);
  console.log({ families: families.length, indexSize: index.byTaskId.size });

  const unmapped = contribs.filter((c) => c.metadataStatus === "unmapped");
  const mapped = contribs.filter((c) => c.metadataStatus === "mapped");
  let unmappedButInFresh = 0;
  let mappedMissingInFresh = 0;
  const samples: string[] = [];
  for (const c of unmapped) {
    if (index.byTaskId.has(String(c.taskId))) {
      unmappedButInFresh += 1;
      if (samples.length < 8) samples.push(String(c.taskId));
    }
  }
  for (const c of mapped) {
    if (!index.byTaskId.has(String(c.taskId))) mappedMissingInFresh += 1;
  }
  console.log(
    JSON.stringify(
      {
        contribs: contribs.length,
        mapped: mapped.length,
        unmapped: unmapped.length,
        unmappedButPresentInFreshMetadata: unmappedButInFresh,
        mappedMissingInFreshMetadata: mappedMissingInFresh,
        sampleUnmappedTaskIdsThatFreshCanMap: samples,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
