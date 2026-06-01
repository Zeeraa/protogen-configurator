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
import { FormsModule } from '@angular/forms';
import { NgbModal, NgbModalModule, NgbModalRef } from '@ng-bootstrap/ng-bootstrap';
import { ToastrService } from 'ngx-toastr';
import { uuidv4 } from 'uuidv7';
import {
  Action,
  ConfigurationService,
  FaceAction,
  FaceTriggerMode,
  InputConfig,
  PinMode,
  SystemConfig,
} from '../../../core/services/configuration-service';
import { HasUnsavedChanges } from '../../../core/guards/unsaved-changes.guard';

const PIN_MODE_OPTIONS: { label: string; value: PinMode }[] = [
  { label: 'Input', value: PinMode.INPUT },
  { label: 'Input (pull-up)', value: PinMode.INPUT_PULLUP },
  { label: 'Input (pull-down)', value: PinMode.INPUT_PULLDOWN },
];

const FACE_TRIGGER_MODE_OPTIONS: { label: string; value: FaceTriggerMode }[] = [
  { label: 'Permanent', value: FaceTriggerMode.Permanent },
  { label: 'Hold', value: FaceTriggerMode.Hold },
  { label: 'Timer', value: FaceTriggerMode.Timer },
];

@Component({
  selector: 'app-config-page',
  imports: [FormsModule, NgbModalModule],
  templateUrl: './config-page.html',
  styleUrl: './config-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfigPage implements OnInit, OnDestroy, HasUnsavedChanges {
  private readonly configService = inject(ConfigurationService);
  private readonly modalService = inject(NgbModal);
  private readonly toastr = inject(ToastrService);

  private readonly deleteModal = viewChild.required<TemplateRef<unknown>>('deleteModal');

  protected readonly pinModeOptions = PIN_MODE_OPTIONS;
  protected readonly faceTriggerModeOptions = FACE_TRIGGER_MODE_OPTIONS;
  protected readonly FaceTriggerMode = FaceTriggerMode;

  protected readonly localConfig = signal<SystemConfig>(this.configService.config());
  protected readonly faces = computed(() => this.configService.faces());

  protected readonly matrixPins = computed(() => {
    const c = this.localConfig();
    return new Set([c.dinPin, c.csPin, c.clkPin]);
  });

  protected isPinUsedByMatrix(pin: number): boolean {
    return this.matrixPins().has(pin);
  }

  protected readonly effectiveDefaultFaceUuid = computed(() => {
    const uuid = this.localConfig().defaultFaceUuid;
    if (!uuid) return null;
    return this.faces().some(f => f.uuid === uuid) ? uuid : null;
  });

  protected readonly defaultFaceInvalid = computed(() => {
    const uuid = this.localConfig().defaultFaceUuid;
    if (!uuid) return true;
    return !this.faces().some(f => f.uuid === uuid);
  });

  private readonly savedSnapshot = signal(JSON.stringify(this.configService.config()));
  private pendingDeleteUuid: string | null = null;
  private deleteModalRef: NgbModalRef | null = null;

  public readonly hasUnsavedChanges = computed(
    () => JSON.stringify(this.localConfig()) !== this.savedSnapshot()
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
    this.deleteModalRef?.close();
  }

  protected save(): void {
    const config = this.localConfig();
    this.configService.saveConfig(config);
    this.savedSnapshot.set(JSON.stringify(config));
    this.toastr.success('Configuration saved');
  }

  protected updateDefaultFace(uuid: string | null): void {
    this.localConfig.update(c => ({ ...c, defaultFaceUuid: uuid ?? null }));
  }

  // --- Inputs ---

  protected addInput(): void {
    const input: InputConfig = {
      uuid: uuidv4(),
      name: '',
      pin: 0,
      mode: PinMode.INPUT_PULLUP,
      invert: false,
      actions: [],
    };
    this.localConfig.update(c => ({ ...c, inputs: [...c.inputs, input] }));
  }

  protected openDeleteInputModal(uuid: string): void {
    this.pendingDeleteUuid = uuid;
    this.deleteModalRef?.close();
    this.deleteModalRef = this.modalService.open(this.deleteModal(), { centered: true });
  }

  protected confirmDeleteInput(): void {
    if (this.pendingDeleteUuid) {
      this.localConfig.update(c => ({ ...c, inputs: c.inputs.filter(i => i.uuid !== this.pendingDeleteUuid) }));
      this.pendingDeleteUuid = null;
    }
  }

  protected pendingDeleteName(): string {
    return this.localConfig().inputs.find(i => i.uuid === this.pendingDeleteUuid)?.name || 'this input';
  }

  protected updateInputField(
    uuid: string,
    field: 'name' | 'pin' | 'mode' | 'invert',
    value: number | string | boolean
  ): void {
    this.localConfig.update(c => ({
      ...c,
      inputs: c.inputs.map(i => i.uuid === uuid ? { ...i, [field]: value } : i),
    }));
  }

  protected updateInputPin(uuid: string, event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!isNaN(value)) this.updateInputField(uuid, 'pin', value);
  }

  // --- Actions ---

  protected addFaceAction(inputUuid: string): void {
    const action: FaceAction = {
      uuid: uuidv4(),
      type: 'face',
      faceUuid: this.faces()[0]?.uuid ?? '',
      mode: FaceTriggerMode.Permanent,
      duration: 1000,
    };
    this.localConfig.update(c => ({
      ...c,
      inputs: c.inputs.map(i =>
        i.uuid === inputUuid ? { ...i, actions: [...i.actions, action] } : i
      ),
    }));
  }

  protected deleteAction(inputUuid: string, actionUuid: string): void {
    this.localConfig.update(c => ({
      ...c,
      inputs: c.inputs.map(i =>
        i.uuid === inputUuid
          ? { ...i, actions: i.actions.filter(a => a.uuid !== actionUuid) }
          : i
      ),
    }));
  }

  protected asFaceAction(action: Action): FaceAction {
    return action as FaceAction;
  }

  protected updateFaceActionField(
    inputUuid: string,
    actionUuid: string,
    field: 'faceUuid' | 'mode' | 'duration',
    value: string | number
  ): void {
    this.localConfig.update(c => ({
      ...c,
      inputs: c.inputs.map(i =>
        i.uuid === inputUuid
          ? {
              ...i,
              actions: i.actions.map(a =>
                a.uuid === actionUuid ? { ...a, [field]: value } : a
              ),
            }
          : i
      ),
    }));
  }

  protected updateFaceActionDuration(inputUuid: string, actionUuid: string, event: Event): void {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (!isNaN(value)) this.updateFaceActionField(inputUuid, actionUuid, 'duration', value);
  }
}
