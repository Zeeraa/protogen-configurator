import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';
import { provideToastService } from "ngx-yet-another-toast-library";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideToastService({
      defaultOptions: {
        progressBar: true,
        dismissible: true,
      },
    }),
    provideMonacoEditor({
      baseUrl: 'assets/monaco/min/vs',
      defaultOptions: { theme: 'vs-dark' },
    }),
  ]
};
