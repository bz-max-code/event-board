import { getAuthToken } from 'deepspace'

export type ActionResponse<T> = { success: true; data: T } | { success: false; error: string }

/** Call a server action (src/actions/index.ts) with the signed-in user's JWT. */
export async function callAction<T = Record<string, unknown>>(
  name: string,
  params: Record<string, unknown>,
): Promise<ActionResponse<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Please sign in first' }
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json().catch(() => null)) as ActionResponse<T> | { error?: string } | null
    if (body && 'success' in body) return body
    return { success: false, error: body?.error ?? `Request failed (${res.status})` }
  } catch {
    return { success: false, error: 'Network error, please try again' }
  }
}
