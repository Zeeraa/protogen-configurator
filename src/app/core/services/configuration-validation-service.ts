import { inject, Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { ConfigurationService, FaceAction, SystemConfig } from './configuration-service';

@Injectable({
  providedIn: 'root',
})
export class ConfigurationValidationService {
  private readonly configuration = inject(ConfigurationService);
  private readonly toastr = inject(ToastrService);

  /**
   * Validates the current configuration for code generation.
   * Shows a toast for the first error found and returns false if invalid.
   */
  public validateForCodegen(): boolean {
    return this.validate(this.configuration.config());
  }

  private validate(config: SystemConfig): boolean {
    if (config.faces.length === 0) {
      this.toastr.error('No faces have been configured. Please add at least one face before generating code.');
      return false;
    }

    if (!config.defaultFaceUuid || !config.faces.some(f => f.uuid === config.defaultFaceUuid)) {
      this.toastr.error('No default face is selected. Please select a default face on the Config page.');
      return false;
    }

    for (const input of config.inputs) {
      for (const action of input.actions) {
        if (action.type === 'face') {
          const fa = action as FaceAction;
          if (!config.faces.some(f => f.uuid === fa.faceUuid)) {
            this.toastr.error(
              `Input "${input.name}" has a face action targeting a face that no longer exists. Please fix it before generating code.`
            );
            return false;
          }
        }
      }
    }

    return true;
  }
}
