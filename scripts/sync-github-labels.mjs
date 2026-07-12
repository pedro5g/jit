import { readFile } from "node:fs/promises";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository) {
  throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
}

const labels = JSON.parse(
  await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
);
const endpoint = `https://api.github.com/repos/${repository}/labels`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

const existing = await request(`${endpoint}?per_page=100`);
const names = new Set(existing.map(({ name }) => name));

for (const label of labels) {
  if (names.has(label.name)) {
    await request(`${endpoint}/${encodeURIComponent(label.name)}`, {
      method: "PATCH",
      body: JSON.stringify(label),
    });
    console.log(`updated ${label.name}`);
  } else {
    await request(endpoint, { method: "POST", body: JSON.stringify(label) });
    console.log(`created ${label.name}`);
  }
}
