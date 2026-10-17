export async function apiFetch<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options?.headers,
    },
  });

  const text = await res.text();
  let data: unknown = null;
  if (text.trim() !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        res.ok
          ? 'Server returned invalid JSON. Check the database connection and that peo_monitoring is installed.'
          : `Request failed (${res.status}). Server returned non-JSON response.`,
      );
    }
  }

  if (!res.ok) {
    const err = data as { error?: string; message?: string } | null;
    throw new Error(err?.error ?? err?.message ?? `Request failed (${res.status})`);
  }

  if (data === null) {
    throw new Error(
      'Empty response from server. Check Apache/PHP errors and the MySQL connection.',
    );
  }

  return data as T;
}
