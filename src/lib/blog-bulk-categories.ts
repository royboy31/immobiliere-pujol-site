export const BULK_CATEGORY_OPERATIONS = ['add', 'remove', 'replace'] as const;

export type BulkCategoryOperation = typeof BULK_CATEGORY_OPERATIONS[number];

export interface BulkCategoryRequest {
  ids: number[];
  operation: BulkCategoryOperation;
  category: string;
}

export function parseBulkCategoryRequest(input: unknown, allowedCategories: Iterable<string>): BulkCategoryRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Requête invalide');
  }

  const body = input as Record<string, unknown>;
  const allowedFields = new Set(['ids', 'operation', 'category']);
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    throw new Error('La requête contient un champ non autorisé');
  }

  if (!Array.isArray(body.ids)) throw new Error('Sélection invalide');
  const ids = [...new Set(body.ids.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))];
  if (ids.length !== body.ids.length || ids.length === 0) throw new Error('Sélection invalide');
  if (ids.length > 2000) throw new Error('Sélection trop importante');

  if (!BULK_CATEGORY_OPERATIONS.includes(body.operation as BulkCategoryOperation)) {
    throw new Error('Action groupée invalide');
  }

  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const allowed = new Set(Array.from(allowedCategories, (value) => value.trim()).filter(Boolean));
  if (!category || !allowed.has(category)) throw new Error('Catégorie invalide');

  return { ids, operation: body.operation as BulkCategoryOperation, category };
}
