export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit & { retry?: boolean }): Promise<T> {
  const { retry = true, ...rest } = init ?? {};
  try {
    const res = await fetch(input, {
      ...rest,
      headers: {
        "Content-Type": "application/json",
        ...(rest.headers || {}),
      },
    });

    if (res.ok) {
      if (res.status === 204) return {} as T;
      return (await res.json()) as T;
    }

    if (retry && (res.status === 429 || res.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return apiFetch<T>(input, { ...rest, retry: false });
    }

    let errorBody: unknown;
    try {
      errorBody = await res.json();
    } catch {
      errorBody = { error: res.statusText };
    }

    if (typeof errorBody === "object" && errorBody && "error" in errorBody) {
      const val = (errorBody as Record<string, unknown>).error;
      if (typeof val === "string") {
        throw new Error(val);
      }
    }

    throw new Error(`Request failed with status ${res.status}`);
  } catch (err) {
    throw err;
  }
}
