import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbModal, NgbModalModule, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ConfigurationService, FaceData, SystemConfig } from '../../../core/services/configuration-service';
import { ToastrService } from 'ngx-toastr';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { LedMatrixCanvas } from '../../components/led-matrix-canvas/led-matrix-canvas';

@Component({
  selector: 'app-face-editor-page',
  imports: [RouterLink, LedMatrixCanvas, NgbModalModule],
  templateUrl: './face-editor-page.html',
  styleUrl: './face-editor-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaceEditorPage implements OnInit, OnDestroy, HasUnsavedChanges {
  private readonly configService = inject(ConfigurationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly modalService = inject(NgbModal);
  private readonly toastr = inject(ToastrService);

  private readonly deleteModal = viewChild.required<TemplateRef<unknown>>('deleteModal');

  protected readonly uuid = signal('');
  protected readonly name = signal('');
  protected readonly data = signal<number[]>([]);
  protected readonly symmetric = signal(false);
  protected readonly brightnessOverride = signal<number | null>(null);
  protected readonly matrixConfig = signal<SystemConfig>(
    this.configService.config()
  );

  private readonly originalName = signal('');
  private readonly originalData = signal<number[]>([]);
  private readonly originalBrightnessOverride = signal<number | null>(null);

  public readonly hasUnsavedChanges = computed(() =>
    this.name() !== this.originalName() ||
    JSON.stringify(this.data()) !== JSON.stringify(this.originalData()) ||
    this.brightnessOverride() !== this.originalBrightnessOverride()
  );

  private deleteModalRef: NgbModalRef | null = null;

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  };

  ngOnInit(): void {
    const uuid = this.route.snapshot.paramMap.get('uuid') ?? '';
    const face = this.configService.faces().find(f => f.uuid === uuid);
    if (!face) {
      this.router.navigate(['/faces']);
      return;
    }
    this.uuid.set(uuid);
    this.name.set(face.name);
    this.brightnessOverride.set(face.brightness ?? null);
    // Ensure data array is large enough: 2 words per panel (lower/upper 32-bit halves)
    const requiredLength = this.matrixConfig().matrixes.length * 2;
    const raw = face.data ?? [];
    const padded = raw.length >= requiredLength
      ? raw
      : [...raw, ...new Array(requiredLength - raw.length).fill(0)];
    this.data.set(padded);
    this.originalName.set(face.name);
    this.originalData.set([...padded]);
    this.originalBrightnessOverride.set(face.brightness ?? null);
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  ngOnDestroy(): void {
    this.deleteModalRef?.close();
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  protected updateName(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
  }

  protected updateBrightnessOverride(event: Event): void {
    const value = Math.min(15, Math.max(0, (event.target as HTMLInputElement).valueAsNumber));
    if (isNaN(value)) return;
    this.brightnessOverride.set(value);
  }

  protected save(): void {
    const brightnessOverride = this.brightnessOverride();
    const face: FaceData = {
      uuid: this.uuid(),
      name: this.name(),
      data: this.data(),
      ...(brightnessOverride !== null ? { brightness: brightnessOverride } : {}),
    };
    this.configService.updateFace(face);
    this.originalName.set(this.name());
    this.originalData.set([...this.data()]);
    this.originalBrightnessOverride.set(brightnessOverride);
    this.toastr.success('Face saved');
    this.router.navigate(['/faces']);
  }

  protected exportFace(): void {
    const brightnessOverride = this.brightnessOverride();
    const name = this.name();
    const payload: Omit<FaceData, 'uuid'> & { brightness?: number } = {
      name,
      data: this.data(),
      ...(brightnessOverride !== null ? { brightness: brightnessOverride } : {}),
    };
    const filename = `${name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'face'}.face.json`;
    this.downloadFile(filename, JSON.stringify(payload, null, 2));
  }

  protected openDeleteModal(): void {
    this.deleteModalRef?.close();
    this.deleteModalRef = this.modalService.open(this.deleteModal(), { centered: true });
  }

  protected deleteFace(): void {
    // Sync originals to current state so hasUnsavedChanges returns false,
    // preventing the unsaved-changes guard from prompting a second confirmation.
    this.originalName.set(this.name());
    this.originalData.set([...this.data()]);
    this.originalBrightnessOverride.set(this.brightnessOverride());
    this.configService.deleteFace(this.uuid());
    this.router.navigate(['/faces']);
  }

  private downloadFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  }
}
