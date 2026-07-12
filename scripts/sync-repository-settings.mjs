import { readFile } from "node:fs/promises";

const token = process.env.GH_ADMIN_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository) {
  throw new Error("GH_ADMIN_TOKEN and GITHUB_REPOSITORY are required");
}

const settings = JSON.parse(
  await readFile(new URL("../.github/repository.json", import.meta.url), "utf8"),
);
const endpoint = `https://api.github.com/repos/${repository}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function request(url, method, body) {
  const response = await fetch(url, { method, headers, body: JSON.stringify(body) });
  if (!response.ok) {
    throw new Error(`${method} ${url} failed: ${response.status} ${await response.text()}`);
  }
}

await request(endpoint, "PATCH", {
  description: settings.description,
  homepage: settings.homepage,
  has_issues: settings.features.issues,
  has_projects: settings.features.projects,
  has_wiki: settings.features.wiki,
  has_discussions: settings.features.discussions,
});
await request(`${endpoint}/topics`, "PUT", { names: settings.topics });
console.log(`updated settings and ${settings.topics.length} topics for ${repository}`);
