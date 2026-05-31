import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { uuidv7 } from 'uuidv7';
import { ConfigurationService, SystemConfig, MatrixPosition } from '../../../core/services/configuration-service';
import { ToastrService } from 'ngx-toastr';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';
import { LedMatrixCanvas } from '../../components/led-matrix-canvas/led-matrix-canvas';

const COLOR_OPTIONS: { label: string; value: string }[] = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Red',   value: '#FF0000' },
  { label: 'Green', value: '#00FF00' },
  { label: 'Blue',  value: '#0000FF' },
];

const ROTATION_OPTIONS: { label: string; value: 0 | 90 | 180 | 270 }[] = [
  { label: '← Left (default)', value: 0   },
  { label: '↓ Bottom',         value: 90  },
  { label: '→ Right',          value: 180 },
  { label: '↑ Top',            value: 270 },
];

@Component({
  selector: 'app-matrix-config-page',
  imports: [LedMatrixCanvas, FormsModule],
  templateUrl: './matrix-config-page.html',
  styleUrl: './matrix-config-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatrixConfigPage implements OnInit, OnDestroy, HasUnsavedChanges {
  private readonly configService = inject(ConfigurationService);
  private readonly toastr = inject(ToastrService);

  protected readonly colorOptions = COLOR_OPTIONS;
  protected readonly rotationOptions = ROTATION_OPTIONS;

  protected readonly matrixConfig = signal<SystemConfig>(
    this.configService.config()
  );

  protected readonly selectedUuid = signal<string | null>(null);

  private readonly savedConfig = signal(JSON.stringify(this.configService.config()));

  public readonly hasUnsavedChanges = computed(() =>
    JSON.stringify(this.matrixConfig()) !== this.savedConfig()
  );

  private readonly onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  };

  ngOnInit(): void {
    window.addEventListener('beforeunload', this.onBeforeUnload);
  }

  ngOnDestroy(): void {
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  protected readonly selectedMatrix = computed(() =>
    this.matrixConfig().matrixes.find(m => m.uuid === this.selectedUuid()) ?? null
  );

  protected readonly sortedMatrixes = computed(() =>
    [...this.matrixConfig().matrixes].sort((a, b) => a.index - b.index)
  );

  protected readonly duplicateIndexes = computed(() => {
    const counts = new Map<number, number>();
    for (const m of this.matrixConfig().matrixes) {
      counts.set(m.index, (counts.get(m.index) ?? 0) + 1);
    }
    return [...counts.entries()].filter(([, count]) => count > 1).map(([index]) => index).sort((a, b) => a - b);
  });

  protected readonly hasOverlap = computed(() => {
    const matrixes = this.matrixConfig().matrixes;
    const size = 8;
    for (let i = 0; i < matrixes.length; i++) {
      for (let j = i + 1; j < matrixes.length; j++) {
        const a = matrixes[i];
        const b = matrixes[j];
        const overlapX = a.x < b.x + size && a.x + size > b.x;
        const overlapY = a.y < b.y + size && a.y + size > b.y;
        if (overlapX && overlapY) return true;
      }
    }
    return false;
  });

  protected selectMatrix(matrix: MatrixPosition): void {
    this.selectedUuid.set(matrix.uuid);
  }

  protected save(): void {
    const config = this.matrixConfig();
    this.savedConfig.set(JSON.stringify(config));
    this.configService.saveConfig(config);
    this.toastr.success('Matrix configuration saved');
  }

  protected updatePin(field: 'dinPin' | 'csPin' | 'clkPin', event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (isNaN(value)) return;
    this.matrixConfig.update(c => ({ ...c, [field]: value }));
  }

  protected updateBrightness(event: Event): void {
    const value = Math.min(15, Math.max(0, (event.target as HTMLInputElement).valueAsNumber));
    if (isNaN(value)) return;
    this.matrixConfig.update(c => ({ ...c, defaultBrightness: value }));
  }

  protected updateSelected(field: 'index' | 'x' | 'y', event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (isNaN(value)) return;
    this.matrixConfig.update(cfg => ({
      ...cfg,
      matrixes: cfg.matrixes.map(m =>
        m.uuid === this.selectedUuid() ? { ...m, [field]: value } : m
      ),
    }));
  }

  protected updateSelectedColor(color: string): void {
    this.matrixConfig.update(cfg => ({
      ...cfg,
      matrixes: cfg.matrixes.map(m =>
        m.uuid === this.selectedUuid() ? { ...m, color } : m
      ),
    }));
  }

  protected updateSelectedRotation(rotation: 0 | 90 | 180 | 270): void {
    this.matrixConfig.update(cfg => ({
      ...cfg,
      matrixes: cfg.matrixes.map(m =>
        m.uuid === this.selectedUuid() ? { ...m, rotation } : m
      ),
    }));
  }

  protected deleteSelected(): void {
    const uuid = this.selectedUuid();
    if (!uuid) return;
    this.deleteMatrix(uuid);
  }

  protected deleteMatrix(uuid: string): void {
    if (this.selectedUuid() === uuid) {
      this.selectedUuid.set(null);
    }
    this.matrixConfig.update(cfg => ({
      ...cfg,
      matrixes: cfg.matrixes
        .filter(m => m.uuid !== uuid)
        .map((m, i) => ({ ...m, index: i })),
    }));
  }

  protected addMatrix(): void {
    this.matrixConfig.update(cfg => {
      const nextIndex = cfg.matrixes.length;
      const { x, y } = this.findFreePosition(cfg.matrixes);
      const lastColor = cfg.matrixes.at(-1)?.color ?? '#00FF00';
      return {
        ...cfg,
        matrixes: [
          ...cfg.matrixes,
          { uuid: uuidv7(), index: nextIndex, x, y, color: lastColor },
        ],
      };
    });
  }

  private findFreePosition(matrixes: MatrixPosition[]): { x: number; y: number } {
    const size = 8; // BOARD_CELLS
    for (let row = 0; row < 256; row += size) {
      for (let col = 0; col < 256; col += size) {
        const overlaps = matrixes.some(
          m =>
            col < m.x + size && m.x < col + size &&
            row < m.y + size && m.y < row + size
        );
        if (!overlaps) return { x: col, y: row };
      }
    }
    return { x: matrixes.length * size, y: 0 };
  }
}
