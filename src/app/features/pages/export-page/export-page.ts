import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, OnDestroy, signal, TemplateRef, viewChild } from '@angular/core';
import { NgbModal, NgbModalModule, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { ArduinoCodegenService } from '../../../core/services/codegen/arduino-codegen-service';
import { ConfigurationService, SystemConfig } from '../../../core/services/configuration-service';
import { EditorComponent } from "ngx-monaco-editor-v2";
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-export-page',
  imports: [NgbModalModule, EditorComponent, FormsModule],
  templateUrl: './export-page.html',
  styleUrl: './export-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportPage implements OnDestroy {
  private readonly arduinoCodegen = inject(ArduinoCodegenService);
  private readonly configService = inject(ConfigurationService);
  private readonly modalService = inject(NgbModal);
  private readonly toastr = inject(ToastrService);

  private readonly importModal = viewChild.required<TemplateRef<unknown>>('importModal');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  private importModalRef: NgbModalRef | null = null;
  private readonly pendingImport = signal<SystemConfig | null>(null);

  protected readonly targetFileName = signal<string | null>(null);
  protected readonly exportMode = signal<ExportMode>('arduino');
  protected readonly code = signal<string | null>(null);
  protected readonly editorOptions = computed(() => {
    const exportMode = this.exportMode();
    let language = "json";

    if (exportMode === 'arduino') {
      language = 'cpp';
    }

    return {
      theme: 'vs-dark', language,
    }
  })

  ngOnDestroy(): void {
    this.importModalRef?.close();
  }

  protected async exportArduino(): Promise<void> {
    this.clear();
    this.toastr.info('Generating Arduino code...');
    const code = await this.arduinoCodegen.generateArduinoCode();
    if (code == null) {
      this.toastr.error('Failed to generate Arduino code. Please check your configuration and try again.');
      return;
    }
    this.toastr.success('Arduino code generated successfully. You can now download it or copy it to clipboard.');
    this.code.set(code);
    this.targetFileName.set("protogen.ino");
  }

  protected clear() {
    this.code.set("");
    this.targetFileName.set(null);
  }

  protected downloadCode(): void {
    const code = this.code();
    const filename = this.targetFileName() ?? 'export.txt';
    if (!code) {
      this.toastr.error('There is no code to download.');
      return;
    }
    this.downloadFile(filename, code);
  }

  protected exportJson(): void {
    const config = this.configService.config();
    this.downloadFile('protogen-config.json', JSON.stringify(config, null, 2));
  }

  protected triggerFileInput(): void {
    this.fileInput().nativeElement.value = '';
    this.fileInput().nativeElement.click();
  }

  protected onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed: unknown = JSON.parse(e.target?.result as string);
        if (!this.isValidConfig(parsed)) {
          this.toastr.error('The selected file does not contain valid protogen configuration data.');
          return;
        }
        this.pendingImport.set(parsed);
        this.importModalRef?.close();
        this.importModalRef = this.modalService.open(this.importModal(), { centered: true });
      } catch {
        this.toastr.error('Failed to parse the selected file. Make sure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  protected confirmImport(): void {
    const config = this.pendingImport();
    if (!config) return;
    this.configService.saveConfig(config);
    this.pendingImport.set(null);
    this.toastr.success('Configuration imported successfully.');
  }

  private isValidConfig(obj: unknown): obj is SystemConfig {
    if (typeof obj !== 'object' || obj === null) return false;
    const c = obj as Record<string, unknown>;
    return (
      Array.isArray(c['matrixes']) &&
      typeof c['dinPin'] === 'number' &&
      typeof c['csPin'] === 'number' &&
      typeof c['clkPin'] === 'number' &&
      typeof c['defaultBrightness'] === 'number' &&
      Array.isArray(c['inputs']) &&
      Array.isArray(c['faces']) &&
      (c['defaultFaceUuid'] === null || typeof c['defaultFaceUuid'] === 'string')
    );
  }

  private downloadFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }
}

type ExportMode = 'arduino';
