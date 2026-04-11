export async function fetchText(
  url: string,
  userAgent: string,
  init?: {
    cf?: RequestInit["cf"];
    fallbackUserAgent?: string;
  },
): Promise<string> {
  const userAgents = [userAgent, init?.fallbackUserAgent]
    .map((item) => item?.trim())
    .filter((item, index, list): item is string => Boolean(item) && list.indexOf(item) === index);

  let lastStatus = 0;
  const errors: string[] = [];

  for (let index = 0; index < userAgents.length; index += 1) {
    const currentUserAgent = userAgents[index];
    const response = await fetch(url, {
      headers: {
        "User-Agent": currentUserAgent,
        Accept: "text/plain, application/json;q=0.9, */*;q=0.8",
      },
      ...(init?.cf ? { cf: init.cf } : {}),
    });

    if (response.ok) {
      return response.text();
    }

    lastStatus = response.status;
    errors.push(`${currentUserAgent}:${response.status}`);
    const shouldRetryWithFallback =
      index < userAgents.length - 1 && (response.status === 401 || response.status === 403);
    if (!shouldRetryWithFallback) {
      break;
    }
  }

  throw new Error(
    `拉取资源失败: ${url} (${lastStatus || "unknown"})` +
      (errors.length > 0 ? `, UA尝试=${errors.join(",")}` : ""),
  );
}
