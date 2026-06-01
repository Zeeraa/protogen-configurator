import { Routes } from '@angular/router';
import { ConfigPage } from './features/pages/config-page/config-page';
import { ExportPage } from './features/pages/export-page/export-page';
import { FaceEditorPage } from './features/pages/face-editor-page/face-editor-page';
import { FacesPage } from './features/pages/faces-page/faces-page';
import { MatrixConfigPage } from './features/pages/matrix-config-page/matrix-config-page';
import { unsavedChangesGuard } from './core/guards/unsaved-changes.guard';
import { AboutPage } from './features/pages/about-page/about-page';

export const routes: Routes = [
  { path: '', component: AboutPage, title: "About - Protogen Configurator" },
  { path: 'config', component: ConfigPage, title: "Config - Protogen Configurator", canDeactivate: [unsavedChangesGuard] },
  { path: 'faces', component: FacesPage, title: "Faces - Protogen Configurator" },
  { path: 'faces/:uuid', component: FaceEditorPage, title: "Edit Face - Protogen Configurator", canDeactivate: [unsavedChangesGuard] },
  { path: 'matrix-config', component: MatrixConfigPage, title: "Matrix Config - Protogen Configurator", canDeactivate: [unsavedChangesGuard] },
  { path: 'export', component: ExportPage, title: "Export - Protogen Configurator" },
];
