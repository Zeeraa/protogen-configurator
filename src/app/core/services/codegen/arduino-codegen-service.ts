import { inject, Injectable } from '@angular/core';
import {
  ConfigurationService,
  FaceAction,
  FaceTriggerMode,
  MatrixPosition,
  PinMode,
  SystemConfig,
} from '../configuration-service';
import { ConfigurationValidationService } from '../configuration-validation-service';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { firstValueFrom } from 'rxjs';
import { BaseCodegen } from './base-codegen';

@Injectable({
  providedIn: 'root',
})
export class ArduinoCodegenService extends BaseCodegen {
  private readonly configuration = inject(ConfigurationService);
  private readonly validation = inject(ConfigurationValidationService);
  private readonly toastr = inject(ToastrService);
  private readonly http = inject(HttpClient);

  public async generateArduinoCode(): Promise<string | null> {
    if (!this.validation.validateForCodegen()) {
      return null;
    }

    const config = this.configuration.config();

    // ── Load template ────────────────────────────────────────
    try {
      const templateCode = await firstValueFrom(
        this.http.get('/templates/arduino.ino', { responseType: 'text' })
      );
      if (!templateCode || !templateCode.startsWith('// Arduino Template')) {
        this.toastr.error('Failed to load code template.');
        return null;
      }

      return this.processTemplate(templateCode, config);
    } catch (err) {
      if (err instanceof HttpErrorResponse) {
        this.toastr.error(`Failed to load code template: ${err.status} ${err.statusText}`);
      } else {
        this.toastr.error('An unexpected error occurred while loading the code template.');
      }
      return null;
    }
  }

  // ── Template processing ──────────────────────────────────────

  private processTemplate(template: string, config: SystemConfig): string {
    // Build UUID → sequential integer ID maps (saves space vs. UUIDs in C code)
    const faceIdMap = new Map<string, number>();
    config.faces.forEach((face, i) => faceIdMap.set(face.uuid, i));

    const matrixCount = config.matrixes.length;
    const defaultFaceId = faceIdMap.get(config.defaultFaceUuid!)!;

    return template
      .replace('{{MATRIX_COUNT}}',    String(matrixCount))
      .replace('{{MATRIX_DIN_PIN}}',  String(config.dinPin))
      .replace('{{MATRIX_CS_PIN}}',   String(config.csPin))
      .replace('{{MATRIX_CLK_PIN}}',  String(config.clkPin))
      .replace('{{FACE_COUNT}}',      String(config.faces.length))
      .replace('{{DEFAULT_FACE_ID}}', String(defaultFaceId))
      .replace('{{INPUT_COUNT}}',     String(config.inputs.length))
      .replace('{{FACE_PROGMEM_DATA}}',  this.buildFaceProgmemData(config, matrixCount))
      .replace('{{FACE_NAME_STRINGS}}',  this.buildFaceNameStrings(config))
      .replace('{{FACE_ARRAY}}',         this.buildFaceArray(config))
      .replace('{{INPUT_DEFINITIONS}}',  this.buildInputDefinitions(config, faceIdMap))
      .replace('{{INPUT_ARRAY}}',        this.buildInputArray(config));
  }

  // ── Section builders ─────────────────────────────────────────

  /**
   * Emits PROGMEM uint32_t arrays for every face.
   * Layout: 2 × uint32_t per panel — lower word (rows 0-3), upper word (rows 4-7).
   * Each byte of the word represents one row: (word >> (row * 8)) & 0xFF.
   * Bitmasks are pre-rotated to compensate for each panel's physical board rotation.
   */
  private buildFaceProgmemData(config: SystemConfig, matrixCount: number): string {
    const lines: string[] = [];

    // Build index → matrix map so we can look up the rotation for each panel slot
    const matrixByIndex = new Map<number, MatrixPosition>();
    config.matrixes.forEach(m => matrixByIndex.set(m.index, m));

    config.faces.forEach((face, i) => {
      lines.push(`// Face ${i}: "${face.name}"`);
      lines.push(`const uint32_t PROGMEM face${i}_data[] = {`);

      const needed = matrixCount * 2;
      const raw = face.data;
      const data = raw.length >= needed
        ? raw
        : [...raw, ...new Array(needed - raw.length).fill(0)];

      const entries: string[] = [];
      for (let p = 0; p < matrixCount; p++) {
        const raw0 = (data[p * 2]     ?? 0) >>> 0;
        const raw1 = (data[p * 2 + 1] ?? 0) >>> 0;

        const boardRotation = (matrixByIndex.get(p)?.rotation ?? 0) as 0 | 90 | 180 | 270;
        const [w0, w1] = this.applyBoardCorrection(raw0, raw1, boardRotation);

        const h0 = `0x${w0.toString(16).padStart(8, '0').toUpperCase()}UL`;
        const h1 = `0x${w1.toString(16).padStart(8, '0').toUpperCase()}UL`;
        const comma = p < matrixCount - 1 ? ',' : '';
        entries.push(`  ${h0}, ${h1}${comma}  // panel ${p}`);
      }

      lines.push(entries.join('\n'));
      lines.push('};');
      lines.push('');
    });

    return lines.join('\n');
  }

  /** Emits PROGMEM name strings for every face. */
  private buildFaceNameStrings(config: SystemConfig): string {
    return config.faces
      .map((face, i) => `const char PROGMEM face${i}_name[] = "${this.escapeCString(face.name)}";`)
      .join('\n');
  }

  /** Emits the Face struct initialiser list (no trailing comma). */
  private buildFaceArray(config: SystemConfig): string {
    return config.faces
      .map((face, i) => {
        const brightness = face.brightness ?? config.defaultBrightness;
        const comma = i < config.faces.length - 1 ? ',' : '';
        return `  { face${i}_data, face${i}_name, ${brightness} }${comma}  // "${face.name}"`;
      })
      .join('\n');
  }

  /**
   * Emits FaceAction objects and Input objects for every configured input.
   * Only action types recognised at codegen time are emitted; unknown types
   * are left as a comment so future action types can be added without breaking
   * existing generated code.
   */
  private buildInputDefinitions(config: SystemConfig, faceIdMap: Map<string, number>): string {
    if (config.inputs.length === 0) return '';

    const lines: string[] = [];

    config.inputs.forEach((input, inputIdx) => {
      lines.push(`// Input ${inputIdx}: "${input.name}" (pin ${input.pin})`);

      // Emit action objects
      input.actions.forEach((action, actionIdx) => {
        if (action.type === 'face') {
          const fa = action as FaceAction;
          const faceId   = faceIdMap.get(fa.faceUuid)!;
          const mode     = this.faceModeToInt(fa.mode);
          const duration = fa.mode === FaceTriggerMode.Timer ? fa.duration : 0;
          lines.push(
            `FaceAction input${inputIdx}_action${actionIdx}(${faceId}, ${mode}, ${duration}UL);`
          );
        } else {
          lines.push(`// action ${actionIdx}: type "${action.type}" — not yet supported`);
        }
      });

      // Emit action pointer array or use nullptr when there are no actions
      if (input.actions.length > 0) {
        const ptrs = input.actions
          .map((_, j) => `&input${inputIdx}_action${j}`)
          .join(', ');
        lines.push(`Action* input${inputIdx}_actions[] = { ${ptrs} };`);
        lines.push(
          `Input input${inputIdx}(${input.pin}, ${this.pinModeToArduino(input.mode)}, ` +
          `${input.invert ? 'true' : 'false'}, input${inputIdx}_actions, ${input.actions.length});`
        );
      } else {
        lines.push(
          `Input input${inputIdx}(${input.pin}, ${this.pinModeToArduino(input.mode)}, ` +
          `${input.invert ? 'true' : 'false'}, nullptr, 0);`
        );
      }

      lines.push('');
    });

    return lines.join('\n');
  }

  /** Emits the Input pointer array entries. */
  private buildInputArray(config: SystemConfig): string {
    return config.inputs.map((_, i) => `  &input${i}`).join(',\n');
  }

  // ── Helpers ───────────────────────────────────────────────────

  private faceModeToInt(mode: FaceTriggerMode): number {
    switch (mode) {
      case FaceTriggerMode.Permanent: return 0;
      case FaceTriggerMode.Hold:      return 1;
      case FaceTriggerMode.Timer:     return 2;
    }
  }

  private pinModeToArduino(mode: PinMode): string {
    switch (mode) {
      case PinMode.INPUT:          return 'INPUT';
      case PinMode.INPUT_PULLUP:   return 'INPUT_PULLUP';
      case PinMode.INPUT_PULLDOWN: return 'INPUT_PULLDOWN';
    }
  }

}
