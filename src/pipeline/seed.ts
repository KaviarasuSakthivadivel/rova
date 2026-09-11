import { db } from "@/db/client";
import { companies } from "@/db/schema";

interface SeedRow {
  name: string;
  ats: string;
  ats_identifier: string;
  careers_url?: string;
}

function parseCsv(text: string): SeedRow[] {
  const [headerLine, ...lines] = text.trim().split("\n");
  if (!headerLine) return [];
  const headers = headerLine.split(",").map((h) => h.trim());

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const values = line.split(",").map((v) => v.trim());
      return Object.fromEntries(headers.map((h, i) => [h, values[i]])) as unknown as SeedRow;
    });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function seedCompanies(csvPath: string) {
  const file = Bun.file(csvPath);
  if (!(await file.exists())) {
    throw new Error(`Seed CSV not found: ${csvPath}`);
  }

  const rows = parseCsv(await file.text());
  console.log(`[seed] read ${rows.length} companies from ${csvPath}`);

  let inserted = 0;
  for (const row of rows) {
    await db
      .insert(companies)
      .values({
        name: row.name,
        slug: slugify(row.name),
        ats: row.ats,
        atsIdentifier: row.ats_identifier,
        careersUrl: row.careers_url,
      })
      .onConflictDoNothing({ target: [companies.ats, companies.atsIdentifier] });
    inserted += 1;
  }

  console.log(`[seed] upserted ${inserted} companies`);
}
