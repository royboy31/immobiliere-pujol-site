// Fire the site rebuild (deploy.yml) via GitHub Actions workflow_dispatch and read
// the latest run status. Mirrors workers/cron-sync/index.ts triggerRedeploy — used
// by the admin "Publier" button so a content publish rebuilds the static site.
//
// Needs GITHUB_TOKEN (fine-grained PAT with actions:write on the site repo) +
// GITHUB_REPO ("owner/repo") as main-app secrets. Until set, publishing still
// snapshots the content but reports that the build wasn't triggered.

export interface DeployEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;      // "owner/repo"
  DEPLOY_WORKFLOW?: string;  // defaults to "deploy.yml"
  DEPLOY_REF?: string;       // git ref to build; defaults to "main" (prod sets "pujol-main")
}

const GH = 'https://api.github.com';
const UA = 'pujol-admin-publish';

export function deployConfigured(env: DeployEnv): boolean {
  return !!(env.GITHUB_TOKEN && env.GITHUB_REPO);
}

/** POST a workflow_dispatch on DEPLOY_WORKFLOW @ DEPLOY_REF. Returns { ok } or an error string. */
export async function triggerDeploy(env: DeployEnv): Promise<{ ok: boolean; error?: string }> {
  if (!deployConfigured(env)) return { ok: false, error: 'GITHUB_TOKEN/GITHUB_REPO not configured' };
  const wf = env.DEPLOY_WORKFLOW || 'deploy.yml';
  try {
    const resp = await fetch(`${GH}/repos/${env.GITHUB_REPO}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
      body: JSON.stringify({ ref: env.DEPLOY_REF || 'main' }),
    });
    if (resp.ok || resp.status === 204) return { ok: true };
    return { ok: false, error: `${resp.status} ${await resp.text()}` };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'network error' };
  }
}

export interface DeployRun {
  id: number;
  status: string;       // queued | in_progress | completed
  conclusion: string | null; // success | failure | cancelled | …
  html_url: string;
  created_at: string;
  event: string;
}

/** Latest deploy.yml run (for polling build progress after a publish). */
export async function latestDeployRun(env: DeployEnv): Promise<DeployRun | null> {
  if (!deployConfigured(env)) return null;
  const wf = env.DEPLOY_WORKFLOW || 'deploy.yml';
  try {
    const resp = await fetch(`${GH}/repos/${env.GITHUB_REPO}/actions/workflows/${wf}/runs?per_page=1`, {
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': UA },
    });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const r = data.workflow_runs?.[0];
    if (!r) return null;
    return { id: r.id, status: r.status, conclusion: r.conclusion, html_url: r.html_url, created_at: r.created_at, event: r.event };
  } catch {
    return null;
  }
}
