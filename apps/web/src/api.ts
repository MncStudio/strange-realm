export async function api<T>(path: string): Promise<T> {
  let response: Response;
  try { response = await fetch(path); } catch { throw new Error('无法连接服务器，请确认已启动 pnpm dev，并连接同一局域网。'); }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || result?.message || '请求失败，请稍后重试。');
  if (result === null) throw new Error('服务器返回了无效数据，请确认前后端均已启动。');
  return result as T;
}
