import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { deleteTestUser, extractCookie, testApp, uniqueEmail } from "../helpers/testApp";

describe("profile routes", () => {
  const app = testApp();
  const email = uniqueEmail("profile");
  let cookie: string;

  beforeAll(async () => {
    const res = await app.request("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "correct-horse-battery" }),
    });
    cookie = extractCookie(res);
  });

  afterAll(() => deleteTestUser(email));

  it("rejects unauthenticated access", async () => {
    const res = await app.request("/api/profile");
    expect(res.status).toBe(401);
  });

  it("returns null before a profile is created", async () => {
    const res = await app.request("/api/profile", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await res.json()).profile).toBeNull();
  });

  it("creates a profile on first PUT", async () => {
    const res = await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        profileText: "Backend engineer. Java, Kafka, AWS.",
        preferences: { locations: ["Remote"], remoteOk: true },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.profile.profileText).toBe("Backend engineer. Java, Kafka, AWS.");
    expect(body.profile.preferences.remoteOk).toBe(true);
  });

  it("updates the existing profile on a second PUT rather than creating another", async () => {
    const res = await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "Updated text.", preferences: {} }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).profile.profileText).toBe("Updated text.");

    const getRes = await app.request("/api/profile", { headers: { Cookie: cookie } });
    expect((await getRes.json()).profile.profileText).toBe("Updated text.");
  });

  it("rejects an empty profileText", async () => {
    const res = await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated resume upload", async () => {
    const form = new FormData();
    form.append("file", new File(["hi"], "resume.txt", { type: "text/plain" }));
    const res = await app.request("/api/profile/resume", { method: "POST", body: form });
    expect(res.status).toBe(401);
  });

  it("extracts text from an uploaded .txt resume", async () => {
    const form = new FormData();
    form.append("file", new File(["Java, Kafka, AWS backend engineer."], "resume.txt", { type: "text/plain" }));

    const res = await app.request("/api/profile/resume", { method: "POST", headers: { Cookie: cookie }, body: form });
    expect(res.status).toBe(200);
    expect((await res.json()).resumeText).toBe("Java, Kafka, AWS backend engineer.");
  });

  it("rejects an unsupported file type", async () => {
    const form = new FormData();
    form.append("file", new File(["binary"], "resume.docx", { type: "application/vnd.openxmlformats" }));

    const res = await app.request("/api/profile/resume", { method: "POST", headers: { Cookie: cookie }, body: form });
    expect(res.status).toBe(400);
  });

  it("rejects a resume request with no file field", async () => {
    const res = await app.request("/api/profile/resume", {
      method: "POST",
      headers: { Cookie: cookie },
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("saves and round-trips resumeText through PUT/GET", async () => {
    const res = await app.request("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ profileText: "About me.", resumeText: "My resume content.", preferences: {} }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).profile.resumeText).toBe("My resume content.");

    const getRes = await app.request("/api/profile", { headers: { Cookie: cookie } });
    expect((await getRes.json()).profile.resumeText).toBe("My resume content.");
  });
});
