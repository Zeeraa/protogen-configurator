import { Routes } from '@angular/router';
import { ConfigPage } from './features/pages/config-page/config-page';
import { ExportPage } from './features/pages/export-page/export-page';
import { FaceEditorPage } from './features/pages/face-editor-page/face-editor-page';
import { FacesPage } from './features/pages/faces-page/faces-page';
import { MatrixConfigPage } from './features/pages/matrix-config-page/matrix-config-page';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'config', pathMatch: 'full' },
  { path: 'config', component: ConfigPage, title: "Config", canDeactivate: [unsavedChangesGuard] },
  { path: 'faces', component: FacesPage, title: "Faces" },
  { path: 'faces/:uuid', component: FaceEditorPage, title: "Edit Face", canDeactivate: [unsavedChangesGuard] },
  { path: 'matrix-config', component: MatrixConfigPage, title: "Matrix Config", canDeactivate: [unsavedChangesGuard] },
  { path: 'export', component: ExportPage, title: "Export" },
];
