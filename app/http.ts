export class ApiError extends Error {
  conflictId?: number;
  datasetChanged?: boolean;
  versionConflict?: boolean;
  constructor(body: {
    error?: string;
    conflictId?: number;
    datasetChanged?: boolean;
    versionConflict?: boolean;
  }) {
    super(body.error || "Request failed");
    Object.assign(this, body);
  }
}
export async function api<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(import.meta.env.BASE_URL + "api" + url, options);
  const body = await response.json();
  if (!response.ok) throw new ApiError(body);
  return body;
}
export const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
