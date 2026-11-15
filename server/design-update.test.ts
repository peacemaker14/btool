import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from './store';
import { createLibraryRoutes } from './library';
import { selectExportVersion } from './export';
import { newRecipe, type Design } from '../shared/types';

test('saving recipe controls keeps accepted code exportable and history immutable even after source deletion', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'btools-design-update-'));
  const store = createStore(directory);
  try {
    const recipe = newRecipe();
    recipe.references = [{ referenceId: crypto.randomUUID(), screenshotId: crypto.randomUUID(), role: 'layout', useCrop: false }];
    const versionId = crypto.randomUUID();
    const design: Design = { id: crypto.randomUUID(), name: recipe.name, recipe: structuredClone(recipe), versions: [{ id: versionId, createdAt: new Date().toISOString(), label: 'Accepted', code: 'export default function Component({config}) { return <h1>{config.content.title}</h1> }', recipe: structuredClone(recipe) }], currentVersionId: versionId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    store.put('designs', design);
    recipe.config.content.title = 'Edited content';
    const response = await createLibraryRoutes(store).request('/designs/' + design.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipe }) });
    expect(response.status).toBe(200);
    const result = await response.json() as Design;
    expect(result.currentVersionId).toBe(versionId);
    expect(result.versions[0].recipe.config.content.title).toBe(design.recipe.config.content.title);
    expect(selectExportVersion(store, design.id).recipe.config.content.title).toBe('Edited content');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
