import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { NgbModal, NgbModalModule, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { uuidv4 } from 'uuidv7';
import { ConfigurationService, FaceData } from '../../../core/services/configuration-service';
import { LedMatrixCanvas } from '../../components/led-matrix-canvas/led-matrix-canvas';

@Component({
  selector: 'app-faces-page',
  imports: [LedMatrixCanvas, NgbModalModule],
  templateUrl: './faces-page.html',
  styleUrl: './faces-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacesPage {
  private readonly router = inject(Router);
  private readonly modalService = inject(NgbModal);
  private readonly toastr = inject(ToastrService);
  protected readonly configService = inject(ConfigurationService);

  private readonly importModal = viewChild.required<TemplateRef<unknown>>('importModal');
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  private importModalRef: NgbModalRef | null = null;
  protected readonly pendingImport = signal<FaceData | null>(null);

  protected addFace(): void {
    const matrixCount = this.configService.config().matrixes.length;
    const dataSize = Math.max(8, matrixCount * 2);
    const face: FaceData = {
      uuid: uuidv4(),
      name: 'New face',
      data: new Array(dataSize).fill(0),
    };
    this.configService.addFace(face);
  }

  protected editFace(face: FaceData): void {
    this.router.navigate(['/faces', face.uuid]);
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
        if (!this.isValidFaceData(parsed)) {
          this.toastr.error('The selected file does not contain valid face data.');
          return;
        }
        this.pendingImport.set({ ...parsed, uuid: uuidv4() });
        this.importModalRef?.close();
        this.importModalRef = this.modalService.open(this.importModal(), { centered: true });
      } catch {
        this.toastr.error('Failed to parse the selected file. Make sure it is a valid JSON file.');
      }
    };
    reader.readAsText(file);
  }

  protected confirmImport(): void {
    const face = this.pendingImport();
    if (!face) return;
    this.configService.addFace(face);
    this.pendingImport.set(null);
    this.toastr.success(`Face "${face.name}" imported successfully.`);
  }

  private isValidFaceData(obj: unknown): obj is Omit<FaceData, 'uuid'> {
    if (typeof obj !== 'object' || obj === null) return false;
    const f = obj as Record<string, unknown>;
    return (
      typeof f['name'] === 'string' &&
      Array.isArray(f['data']) &&
      (f['brightness'] === undefined || typeof f['brightness'] === 'number')
    );
  }
}
