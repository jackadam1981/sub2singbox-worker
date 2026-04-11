export async function fetchText(url: string, userAgent: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`拉取资源失败: ${url} (${response.status})`);
  }

  return response.text();
}
