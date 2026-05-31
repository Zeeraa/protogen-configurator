import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  NgZone,
  OnDestroy,
  OnInit,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatrixPosition, SystemConfig } from '../../../core/services/configuration-service';

export type LedMatrixCanvasMode = 'static' | 'layout-editor' | 'drawing';

/** Size of one LED cell in pixels (at scale 1) */
const CELL_PX = 16;
/** Number of cells per MAX7219 board (8x8) */
const BOARD_CELLS = 8;
/** Full board size in pixels at scale 1 */
const BOARD_PX = CELL_PX * BOARD_CELLS;

@Component({
  selector: 'app-led-matrix-canvas',
  templateUrl: './led-matrix-canvas.html',
  styleUrl: './led-matrix-canvas.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedMatrixCanvas implements OnInit, AfterViewInit, OnDestroy {
  private readonly zone = inject(NgZone);

  /** Current layout config — supports two-way binding via signal */
  public readonly config = model.required<SystemConfig>();

  /**
   * Canvas interaction mode.
   * - `layout-editor`: pan, zoom, drag matrices (default)
   * - `drawing`: pan, zoom, click/drag to toggle LEDs
   * - `static`: display only, no interaction
   */
  public readonly mode = input<LedMatrixCanvasMode>('layout-editor');

  /** When true the user can drag matrices in layout-editor mode */
  public readonly editable = input(false);

  /** When true all LEDs are shown lit in layout-editor mode */
  public readonly allLit = input(false);

  /** When true the matrix index number is displayed centered on each board */
  public readonly showIndex = input(false);

  /** UUID of the matrix to highlight with a selection outline */
  public readonly highlightedUuid = input<string | null>(null);

  /**
   * LED drawing data (drawing / static modes).
   * Two 32-bit unsigned integers per panel stored flat:
   *   drawData[panelIndex * 2 + 0]  — lower word: rows 0-3 (bit = row*8 + col)
   *   drawData[panelIndex * 2 + 1]  — upper word: rows 4-7 (bit = (row-4)*8 + col)
   */
  public readonly drawData = model<number[]>([]);

  /**
   * When true, painting a cell on panel `i` also paints the horizontally-mirrored
   * cell on panel `(totalPanels - 1) - i`.
   */
  public readonly symmetric = input(false);

  /** Emitted when a matrix board is clicked in layout-editor mode (without dragging) */
  public readonly matrixClicked = output<MatrixPosition>();

  protected readonly viewportRef = viewChild.required<ElementRef<HTMLDivElement>>('viewport');

  protected readonly boardPx = BOARD_PX;
  protected readonly cellPx = CELL_PX;
  protected readonly boardCells = BOARD_CELLS;

  /** Grid lines array for the background grid */
  protected readonly gridLines = Array.from({ length: BOARD_CELLS + 1 }, (_, i) => i);

  protected readonly scale = signal(1);
  protected readonly panX = signal(0);
  protected readonly panY = signal(0);

  protected readonly isEditable = computed(
    () => this.mode() === 'layout-editor' && this.editable()
  );

  protected readonly transform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.scale()})`
  );

  protected readonly gridStyle = computed(() => {
    const size = 24 * this.scale();
    return {
      'background-size': `${size}px ${size}px`,
      'background-position': `${this.panX()}px ${this.panY()}px`,
    };
  });

  protected readonly boardGridStyle = computed(() => {
    const size = BOARD_PX * this.scale();
    const px = this.panX();
    const py = this.panY();
    return {
      'background-image':
        'linear-gradient(to right, var(--bs-border-color) 1px, transparent 1px),' +
        'linear-gradient(to bottom, var(--bs-border-color) 1px, transparent 1px)',
      'background-size': `${size}px ${size}px`,
      'background-position': `${px}px ${py}px`,
    };
  });

  // Pan state
  private isPanning = false;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;

  // Drag state (mouse)
  private draggingIndex: number | null = null;
  private dragStartMouseX = 0;
  private dragStartMouseY = 0;
  private dragStartBoardX = 0;
  private dragStartBoardY = 0;
  private wasDragged = false;

  // Touch drag state
  private touchDraggingMatrix: MatrixPosition | null = null;
  private touchDragPointerId = -1;
  private touchDragStartX = 0;
  private touchDragStartY = 0;
  private touchDragBoardX = 0;
  private touchDragBoardY = 0;
  private touchWasDragged = false;

  // Touch pan state
  private isPanTouch = false;
  private panTouchId = -1;

  // Pinch-to-zoom state
  private pinchActive = false;
  private pinchStartDist = 0;
  private pinchStartScale = 0;
  private pinchOriginX = 0;
  private pinchOriginY = 0;

  // Drawing state
  private isDrawingActive = false;
  private paintState = false;
  private drawTouchId = -1;
  private strokeSnapshot: number[] = [];

  // Undo / redo stacks (each entry is a full drawData snapshot)
  private readonly undoStack: number[][] = [];
  private readonly redoStack: number[][] = [];
  private readonly MAX_HISTORY = 2048;

  private readonly abortController = new AbortController();
  private resizeObserver: ResizeObserver | null = null;

  ngOnInit(): void {
    const abortSignal = this.abortController.signal;
    this.zone.runOutsideAngular(() => {
      const opts = { signal: abortSignal } as AddEventListenerOptions;
      const passiveOpts = { signal: abortSignal, passive: false } as AddEventListenerOptions;
      window.addEventListener('mousemove', this.onMouseMove, opts);
      window.addEventListener('mouseup', this.onMouseUp, opts);
      window.addEventListener('touchmove', this.onTouchMove, passiveOpts);
      window.addEventListener('touchend', this.onTouchEnd, opts);
      window.addEventListener('keydown', this.onKeyDown, opts);
    });
  }

  ngAfterViewInit(): void {
    requestAnimationFrame(() => {
      if (this.mode() === 'static') {
        this.fitToViewport();
      } else {
        this.centerOnContent();
      }
    });
    this.zone.runOutsideAngular(() => {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.mode() === 'static') {
          this.fitToViewport();
        }
      });
      this.resizeObserver.observe(this.viewportRef().nativeElement);
    });
  }

  ngOnDestroy(): void {
    this.abortController.abort();
    this.resizeObserver?.disconnect();
  }

  private centerOnContent(): void {
    const matrixes = this.config().matrixes;
    if (!matrixes.length) return;
    const viewport = this.viewportRef().nativeElement;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;
    const s = this.scale();
    const minX = Math.min(...matrixes.map(m => m.x));
    const minY = Math.min(...matrixes.map(m => m.y));
    const maxX = Math.max(...matrixes.map(m => m.x)) + BOARD_CELLS;
    const maxY = Math.max(...matrixes.map(m => m.y)) + BOARD_CELLS;
    const contentW = (maxX - minX) * CELL_PX * s;
    const contentH = (maxY - minY) * CELL_PX * s;
    const contentL = minX * CELL_PX * s;
    const contentT = minY * CELL_PX * s;
    this.zone.run(() => {
      this.panX.set(vw / 2 - contentL - contentW / 2);
      this.panY.set(vh / 2 - contentT - contentH / 2);
    });
  }

  /**
   * Scales and centers all panels to fill the viewport (used in static mode).
   * No zoom limits are applied — the scale is computed to always fit all panels.
   */
  private fitToViewport(): void {
    const matrixes = this.config().matrixes;
    if (!matrixes.length) return;
    const viewport = this.viewportRef().nativeElement;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return;

    const minX = Math.min(...matrixes.map(m => m.x));
    const minY = Math.min(...matrixes.map(m => m.y));
    const maxX = Math.max(...matrixes.map(m => m.x)) + BOARD_CELLS;
    const maxY = Math.max(...matrixes.map(m => m.y)) + BOARD_CELLS;
    const contentW = (maxX - minX) * CELL_PX;
    const contentH = (maxY - minY) * CELL_PX;

    const PADDING = 16;
    const newScale = Math.min(
      (vw - PADDING * 2) / contentW,
      (vh - PADDING * 2) / contentH,
    );

    const scaledContentL = minX * CELL_PX * newScale;
    const scaledContentT = minY * CELL_PX * newScale;
    const scaledW = contentW * newScale;
    const scaledH = contentH * newScale;

    this.zone.run(() => {
      this.scale.set(newScale);
      this.panX.set(vw / 2 - scaledContentL - scaledW / 2);
      this.panY.set(vh / 2 - scaledContentT - scaledH / 2);
    });
  }

  /** Returns whether the LED at (row, col) in the given panel index is on. */
  protected isLedOn(matrixIndex: number, row: number, col: number): boolean {
    const data = this.drawData();
    const bitIndex = row * BOARD_CELLS + col;
    const wordIndex = matrixIndex * 2 + (bitIndex >= 32 ? 1 : 0);
    const localBit = bitIndex % 32;
    return !!((data[wordIndex] ?? 0) & (1 << localBit));
  }

  /** Returns the background color for a cell, or null for off. */
  protected getLedColor(matrix: MatrixPosition, row: number, col: number): string | null {
    if (this.mode() === 'layout-editor') {
      return this.allLit() ? matrix.color : null;
    }
    return this.isLedOn(matrix.index, row, col) ? matrix.color : null;
  }

  /**
   * Returns IN/OUT arrow descriptors for a board based on its rotation.
   * Shown in layout-editor+editable mode to indicate DIN and DOUT sides.
   */
  protected boardArrows(matrix: MatrixPosition): { side: string; label: string; type: 'in' | 'out' }[] {
    const SIDES = ['left', 'top', 'right', 'bottom'];
    // Arrow pointing INTO the board from each side: left→, top↓, right←, bottom↑
    const INTO = ['→', '↓', '←', '↑'];
    const rot = matrix.rotation ?? 0;
    // Each 90° CW board rotation moves DIN: left(0)→bottom(3)→right(2)→top(1)
    const inIdx = (3 * (rot / 90)) % 4;
    const outIdx = (inIdx + 2) % 4;
    const inArrow = INTO[inIdx];
    return [
      { side: SIDES[inIdx],  label: `${inArrow} IN`,  type: 'in' },
      { side: SIDES[outIdx], label: `OUT ${inArrow}`, type: 'out' },
    ];
  }

  /**
   * Resolves which panel cell lies under a viewport-space coordinate pair.
   * Returns null if the coordinate is not over any panel.
   */
  private getCellAtViewportCoords(
    vpX: number,
    vpY: number,
  ): { matrixIndex: number; row: number; col: number } | null {
    const canvasX = (vpX - this.panX()) / this.scale();
    const canvasY = (vpY - this.panY()) / this.scale();
    for (const matrix of this.config().matrixes) {
      const boardLeft = matrix.x * CELL_PX;
      const boardTop = matrix.y * CELL_PX;
      if (
        canvasX >= boardLeft && canvasX < boardLeft + BOARD_PX &&
        canvasY >= boardTop && canvasY < boardTop + BOARD_PX
      ) {
        const col = Math.floor((canvasX - boardLeft) / CELL_PX);
        const row = Math.floor((canvasY - boardTop) / CELL_PX);
        if (row >= 0 && row < BOARD_CELLS && col >= 0 && col < BOARD_CELLS) {
          return { matrixIndex: matrix.index, row, col };
        }
      }
    }
    return null;
  }

  /** Sets a single LED bit inside an existing mutable data array (no signal update). */
  private setBit(data: number[], matrixIndex: number, row: number, col: number, value: boolean): void {
    const bitIndex = row * BOARD_CELLS + col;
    const wordIndex = matrixIndex * 2 + (bitIndex >= 32 ? 1 : 0);
    const localBit = bitIndex % 32;
    while (data.length <= wordIndex) data.push(0);
    if (value) {
      data[wordIndex] = (data[wordIndex] | (1 << localBit)) >>> 0;
    } else {
      data[wordIndex] = (data[wordIndex] & ~(1 << localBit)) >>> 0;
    }
  }

  /** Pushes the current snapshot onto the undo stack and clears redo. */
  private commitStroke(): void {
    if (this.undoStack.length >= this.MAX_HISTORY) this.undoStack.shift();
    this.undoStack.push(this.strokeSnapshot);
    this.redoStack.length = 0;
  }

  undo(): void {
    if (!this.undoStack.length) return;
    this.redoStack.push([...this.drawData()]);
    this.drawData.set(this.undoStack.pop()!);
  }

  redo(): void {
    if (!this.redoStack.length) return;
    this.undoStack.push([...this.drawData()]);
    this.drawData.set(this.redoStack.pop()!);
  }

  /** Sets a single LED bit and updates drawData. When symmetric is enabled also paints the mirror. */
  private paintCell(matrixIndex: number, row: number, col: number, value: boolean): void {
    const data = [...this.drawData()];
    this.setBit(data, matrixIndex, row, col, value);

    if (this.symmetric()) {
      const totalPanels = this.config().matrixes.length;
      const mirrorIndex = (totalPanels - 1) - matrixIndex;
      if (mirrorIndex !== matrixIndex) {
        const mirrorCol = (BOARD_CELLS - 1) - col;
        this.setBit(data, mirrorIndex, row, mirrorCol, value);
      }
    }

    this.drawData.set(data);
  }

  protected onWheel(event: WheelEvent): void {
    if (this.mode() === 'static') return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(4, Math.max(0.25, this.scale() * delta));

    // Zoom towards cursor
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    this.panX.set(mouseX - (mouseX - this.panX()) * (newScale / this.scale()));
    this.panY.set(mouseY - (mouseY - this.panY()) * (newScale / this.scale()));
    this.scale.set(newScale);
  }

  protected onCanvasMouseDown(event: MouseEvent): void {
    if (this.mode() === 'static' || event.button !== 0) return;
    this.isPanning = true;
    this.panStartX = event.clientX;
    this.panStartY = event.clientY;
    this.panOriginX = this.panX();
    this.panOriginY = this.panY();
  }

  protected onBoardMouseDown(event: MouseEvent, matrix: MatrixPosition): void {
    event.stopPropagation();
    this.wasDragged = false;
    if (this.mode() === 'drawing') {
      if (event.button !== 0) return;
      const rect = this.viewportRef().nativeElement.getBoundingClientRect();
      const cell = this.getCellAtViewportCoords(event.clientX - rect.left, event.clientY - rect.top);
      if (cell) {
        this.strokeSnapshot = [...this.drawData()];
        this.paintState = !this.isLedOn(cell.matrixIndex, cell.row, cell.col);
        this.isDrawingActive = true;
        this.paintCell(cell.matrixIndex, cell.row, cell.col, this.paintState);
      }
      return;
    }
    if (!this.isEditable()) return;
    this.draggingIndex = matrix.index;
    this.dragStartMouseX = event.clientX;
    this.dragStartMouseY = event.clientY;
    this.dragStartBoardX = matrix.x;
    this.dragStartBoardY = matrix.y;
  }

  protected onBoardClick(event: MouseEvent, matrix: MatrixPosition): void {
    event.stopPropagation();
    if (this.mode() === 'layout-editor' && !this.wasDragged) {
      this.matrixClicked.emit(matrix);
    }
  }

  protected onBoardKeyDown(event: KeyboardEvent, matrix: MatrixPosition): void {
    if (this.mode() !== 'layout-editor') return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.matrixClicked.emit(matrix);
    }
  }

  protected onViewportTouchStart(event: TouchEvent): void {
    if (this.mode() === 'static') return;
    if (event.touches.length === 2) {
      this.startPinch(event);
      return;
    }
    if (event.touches.length === 1 && this.touchDraggingMatrix === null && !this.isDrawingActive) {
      const t = event.touches[0];
      this.panTouchId = t.identifier;
      this.isPanTouch = true;
      this.panStartX = t.clientX;
      this.panStartY = t.clientY;
      this.panOriginX = this.panX();
      this.panOriginY = this.panY();
    }
  }

  protected onBoardTouchStart(event: TouchEvent, matrix: MatrixPosition): void {
    event.stopPropagation();
    if (this.mode() === 'static') return;
    if (event.touches.length === 2) {
      this.startPinch(event);
      return;
    }
    if (event.touches.length === 1) {
      if (this.mode() === 'drawing') {
        const t = event.touches[0];
        const rect = this.viewportRef().nativeElement.getBoundingClientRect();
        const cell = this.getCellAtViewportCoords(t.clientX - rect.left, t.clientY - rect.top);
        if (cell) {
          this.strokeSnapshot = [...this.drawData()];
          this.paintState = !this.isLedOn(cell.matrixIndex, cell.row, cell.col);
          this.drawTouchId = t.identifier;
          this.isDrawingActive = true;
          this.zone.run(() => this.paintCell(cell.matrixIndex, cell.row, cell.col, this.paintState));
        }
        return;
      }
      if (this.isEditable()) {
        const t = event.touches[0];
        this.touchDraggingMatrix = matrix;
        this.touchDragPointerId = t.identifier;
        this.touchDragStartX = t.clientX;
        this.touchDragStartY = t.clientY;
        this.touchDragBoardX = matrix.x;
        this.touchDragBoardY = matrix.y;
        this.touchWasDragged = false;
      }
    }
  }

  private startPinch(event: TouchEvent): void {
    const t0 = event.touches[0];
    const t1 = event.touches[1];
    this.pinchActive = true;
    this.isPanTouch = false;
    // Cancel any in-progress drawing when a second finger lands
    this.isDrawingActive = false;
    this.drawTouchId = -1;
    this.pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    this.pinchStartScale = this.scale();
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    this.pinchOriginX = (t0.clientX + t1.clientX) / 2 - rect.left;
    this.pinchOriginY = (t0.clientY + t1.clientY) / 2 - rect.top;
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.isDrawingActive) {
      const rect = this.viewportRef().nativeElement.getBoundingClientRect();
      const cell = this.getCellAtViewportCoords(event.clientX - rect.left, event.clientY - rect.top);
      if (cell) {
        this.zone.run(() => this.paintCell(cell.matrixIndex, cell.row, cell.col, this.paintState));
      }
      return;
    }

    if (this.draggingIndex !== null) {
      const dx = (event.clientX - this.dragStartMouseX) / this.scale();
      const dy = (event.clientY - this.dragStartMouseY) / this.scale();
      // Snap to 1 LED pixel
      const newX = Math.round(this.dragStartBoardX + dx / CELL_PX);
      const newY = Math.round(this.dragStartBoardY + dy / CELL_PX);

      if (Math.abs(event.clientX - this.dragStartMouseX) > 3 || Math.abs(event.clientY - this.dragStartMouseY) > 3) {
        this.wasDragged = true;
      }

      this.zone.run(() => {
        const current = this.config();
        const matrixes = current.matrixes.map(m =>
          m.index === this.draggingIndex ? { ...m, x: newX, y: newY } : m
        );
        this.config.set({ ...current, matrixes });
      });
      return;
    }

    if (this.isPanning) {
      const dx = event.clientX - this.panStartX;
      const dy = event.clientY - this.panStartY;
      this.zone.run(() => {
        this.panX.set(this.panOriginX + dx);
        this.panY.set(this.panOriginY + dy);
      });
    }
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.mode() !== 'drawing') return;
    const isUndo = event.key === 'z' && event.ctrlKey && !event.shiftKey;
    const isRedo = (event.key === 'y' && event.ctrlKey) || (event.key === 'z' && event.ctrlKey && event.shiftKey);
    if (isUndo) {
      event.preventDefault();
      this.zone.run(() => this.undo());
    } else if (isRedo) {
      event.preventDefault();
      this.zone.run(() => this.redo());
    }
  };

  private readonly onMouseUp = (): void => {
    if (this.isDrawingActive) this.commitStroke();
    this.isPanning = false;
    this.draggingIndex = null;
    this.isDrawingActive = false;
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();

    if (this.pinchActive && event.touches.length >= 2) {
      const t0 = event.touches[0];
      const t1 = event.touches[1];
      const newDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      const newScale = Math.min(4, Math.max(0.25, this.pinchStartScale * (newDist / this.pinchStartDist)));
      const scaleFactor = newScale / this.scale();
      this.zone.run(() => {
        this.panX.set(this.pinchOriginX - (this.pinchOriginX - this.panX()) * scaleFactor);
        this.panY.set(this.pinchOriginY - (this.pinchOriginY - this.panY()) * scaleFactor);
        this.scale.set(newScale);
      });
      return;
    }

    if (this.isDrawingActive && this.drawTouchId !== -1) {
      const t = Array.from(event.touches).find(touch => touch.identifier === this.drawTouchId);
      if (t) {
        const rect = this.viewportRef().nativeElement.getBoundingClientRect();
        const cell = this.getCellAtViewportCoords(t.clientX - rect.left, t.clientY - rect.top);
        if (cell) {
          this.zone.run(() => this.paintCell(cell.matrixIndex, cell.row, cell.col, this.paintState));
        }
      }
      return;
    }

    if (this.touchDraggingMatrix !== null) {
      const t = Array.from(event.touches).find(touch => touch.identifier === this.touchDragPointerId);
      if (!t) return;
      const dx = (t.clientX - this.touchDragStartX) / this.scale();
      const dy = (t.clientY - this.touchDragStartY) / this.scale();
      const newX = Math.round(this.touchDragBoardX + dx / CELL_PX);
      const newY = Math.round(this.touchDragBoardY + dy / CELL_PX);
      if (Math.abs(t.clientX - this.touchDragStartX) > 3 || Math.abs(t.clientY - this.touchDragStartY) > 3) {
        this.touchWasDragged = true;
      }
      const uuid = this.touchDraggingMatrix.uuid;
      this.zone.run(() => {
        const current = this.config();
        this.config.set({
          ...current,
          matrixes: current.matrixes.map(m => m.uuid === uuid ? { ...m, x: newX, y: newY } : m),
        });
      });
      return;
    }

    if (this.isPanTouch) {
      const t = Array.from(event.touches).find(touch => touch.identifier === this.panTouchId);
      if (!t) return;
      const dx = t.clientX - this.panStartX;
      const dy = t.clientY - this.panStartY;
      this.zone.run(() => {
        this.panX.set(this.panOriginX + dx);
        this.panY.set(this.panOriginY + dy);
      });
    }
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    const activeIds = Array.from(event.touches).map(t => t.identifier);
    if (this.pinchActive && event.touches.length < 2) {
      this.pinchActive = false;
      if (event.touches.length === 1) {
        const t = event.touches[0];
        this.panTouchId = t.identifier;
        this.isPanTouch = true;
        this.panStartX = t.clientX;
        this.panStartY = t.clientY;
        this.panOriginX = this.panX();
        this.panOriginY = this.panY();
      }
      return;
    }

    if (this.isDrawingActive && this.drawTouchId !== -1 && !activeIds.includes(this.drawTouchId)) {
      this.commitStroke();
      this.isDrawingActive = false;
      this.drawTouchId = -1;
      return;
    }

    if (this.touchDraggingMatrix !== null && !activeIds.includes(this.touchDragPointerId)) {
      if (!this.touchWasDragged) {
        const matrix = this.touchDraggingMatrix;
        this.zone.run(() => this.matrixClicked.emit(matrix));
      }
      this.touchDraggingMatrix = null;
      this.touchDragPointerId = -1;
    }

    if (this.isPanTouch && !activeIds.includes(this.panTouchId)) {
      this.isPanTouch = false;
    }
  };
}
