import type { PersonLifeNotebookModel, PersonLifeNotebookSpec } from "./person-life-notebook-core.js";

export const FIVE_K_PERSON_LIFE_NOTEBOOK: PersonLifeNotebookSpec;
export const PERSON_LIFE_NOTEBOOK_CATALOG: readonly PersonLifeNotebookSpec[];
export function selectCatalogPersonLifeNotebook(state: Record<string, unknown>): { spec: PersonLifeNotebookSpec; model: PersonLifeNotebookModel } | null;
