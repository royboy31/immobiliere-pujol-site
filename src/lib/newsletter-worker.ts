// Thin client for talking to the pujol-email worker's newsletter endpoints.
// All Brevo access is centralised in that worker (one place for BREVO_API_KEY);
// the main app only renders HTML and calls the worker with a shared token.
//
// Config comes from the main-app Worker env:
//   EMAIL_WORKER_URL          e.g. https://pujol-email.roy-68a.workers.dev
//   NEWSLETTER_INTERNAL_TOKEN shared secret with the email worker
// Both are absent locally until Brevo is provisioned → callers get a clear 501.

interface WorkerConfig { url: string; token: string; }

export async function getWorkerConfig(): Promise<WorkerConfig | null> {
  try {
    const { env } = await import('cloudflare:workers');
    const url = (env as any).EMAIL_WORKER_URL as string | undefined;
    const token = (env as any).NEWSLETTER_INTERNAL_TOKEN as string | undefined;
    if (!url || !token) return null;
    return { url: url.replace(/\/$/, ''), token };
  } catch {
    return null;
  }
}

export async function callWorker(path: string, payload: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const cfg = await getWorkerConfig();
  if (!cfg) {
    return { ok: false, status: 501, data: { error: "Envoi non configuré : EMAIL_WORKER_URL / NEWSLETTER_INTERNAL_TOKEN manquants (Brevo pas encore provisionné)." } };
  }
  const res = await fetch(`${cfg.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-token': cfg.token },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
