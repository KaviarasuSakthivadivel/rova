import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";

export interface DigestJob {
  title: string;
  companyName: string;
  location: string | null;
  jobUrl: string;
  description: string | null;
  /** Set only on the ranked (LLM) path — renders as "why you're seeing
   * this". Absent on the deterministic v1 path (no ranking configured/
   * available), which falls back to the plain description snippet. */
  score?: number;
  reasons?: string[];
}

export interface DigestEmailProps {
  jobs: DigestJob[];
}

/**
 * Digest v1 (plain filtered list) and v2 (ranked + "why you're seeing
 * this") share one template — v2 is just v1 with `score`/`reasons` set
 * per job. See PRD.md §10.
 */
export function DigestEmail({ jobs }: DigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{`${jobs.length} new role${jobs.length === 1 ? "" : "s"} worth a look`}</Preview>
      <Body style={{ backgroundColor: "#f8fafc", fontFamily: "sans-serif", padding: "24px 0" }}>
        <Container style={{ backgroundColor: "#ffffff", borderRadius: "8px", padding: "32px", maxWidth: "560px" }}>
          <Heading style={{ fontSize: "20px", color: "#0f172a" }}>
            {jobs.length} new role{jobs.length === 1 ? "" : "s"} on Rova
          </Heading>
          <Text style={{ color: "#475569", fontSize: "14px" }}>
            Freshly crawled from company career pages, matching your saved preferences.
          </Text>

          {jobs.map((job, i) => (
            <Section key={job.jobUrl} style={{ marginTop: i === 0 ? "24px" : "20px" }}>
              <Text style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>
                <Link href={job.jobUrl} style={{ color: "#0f172a", textDecoration: "none" }}>
                  {job.title}
                </Link>
                {typeof job.score === "number" && (
                  <span style={{ marginLeft: "8px", fontSize: "12px", fontWeight: 500, color: "#4f46e5" }}>
                    {job.score}% match
                  </span>
                )}
              </Text>
              <Text style={{ margin: "2px 0 0", fontSize: "13px", color: "#64748b" }}>
                {job.companyName}
                {job.location ? ` · ${job.location}` : ""}
              </Text>

              {job.reasons && job.reasons.length > 0 ? (
                <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                  {job.reasons.map((reason) => (
                    <li key={reason} style={{ fontSize: "13px", color: "#334155" }}>
                      {reason}
                    </li>
                  ))}
                </ul>
              ) : (
                job.description && (
                  <Text style={{ margin: "6px 0 0", fontSize: "13px", color: "#334155" }}>
                    {job.description.slice(0, 180)}
                    {job.description.length > 180 ? "…" : ""}
                  </Text>
                )
              )}
              <Hr style={{ marginTop: "16px", borderColor: "#e2e8f0" }} />
            </Section>
          ))}

          <Text style={{ fontSize: "12px", color: "#94a3b8" }}>
            You're getting this because you have a Rova profile. Manage your preferences in the app.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
