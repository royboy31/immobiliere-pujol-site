export type ArticleStatus = 'draft' | 'published';
export type ArticleStatusAction = 'preserve' | 'publish' | 'draft';

/** Resolve the explicit editor action without trusting a client-provided status. */
export function resolveArticleStatus(current: ArticleStatus, action: unknown): ArticleStatus {
  if (action === undefined || action === null || action === 'preserve') return current;
  if (action === 'publish') return 'published';
  if (action === 'draft') return 'draft';
  throw new Error('Action de statut invalide');
}

export interface PendingPublishPreview {
  articles: { id: number; slug: string; title: string; action: 'online' | 'remove' }[];
  experts: { id: number; slug: string; title: string }[];
  pages: { id: number; slug: string; title: string }[];
}

/** Stable token used to reject publication if the reviewed pending set changed. */
export function pendingPreviewToken(preview: PendingPublishPreview): string {
  return JSON.stringify({
    articles: preview.articles.map((item) => [item.id, item.action]),
    experts: preview.experts.map((item) => item.id),
    pages: preview.pages.map((item) => item.id),
  });
}

export function pendingPreviewCount(preview: PendingPublishPreview): number {
  return preview.articles.length + preview.experts.length + preview.pages.length;
}
