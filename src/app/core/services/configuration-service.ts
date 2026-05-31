import { computed, Injectable, signal } from '@angular/core';
import { DEFAULT_CONFIG, DEFAULT_MATRIXES, DEFAULT_PINS } from '../DefaultConfiguration';
import { LocalStorageKeys } from '../LocalStorageKeys';


@Injectable({
  providedIn: 'root',
})
export class ConfigurationService {
  readonly config = signal<SystemConfig>(DEFAULT_CONFIG);
  readonly faces = computed(() => this.config().faces);

  constructor() {
    const matrixes = this.loadKey<MatrixPosition[]>(LocalStorageKeys.Matrixes) ?? DEFAULT_MATRIXES;
    const pins = this.loadKey<{ dinPin: number; csPin: number; clkPin: number }>(LocalStorageKeys.MatrixPins) ?? DEFAULT_PINS;
    const defaultBrightness = this.loadKey<number>(LocalStorageKeys.DefaultBrightness) ?? 8;
    const inputs = this.loadKey<InputConfig[]>(LocalStorageKeys.Inputs) ?? [];
    const faces = this.loadKey<FaceData[]>(LocalStorageKeys.Faces) ?? [];
    const defaultFaceUuid = this.loadKey<string>(LocalStorageKeys.defaultFace) ?? null;
    this.config.set({ ...pins, matrixes, defaultBrightness, inputs, faces, defaultFaceUuid });
  }

  saveConfig(config: SystemConfig): void {
    this.config.set(config);
    localStorage.setItem(LocalStorageKeys.Matrixes, JSON.stringify(config.matrixes));
    localStorage.setItem(LocalStorageKeys.MatrixPins, JSON.stringify({ dinPin: config.dinPin, csPin: config.csPin, clkPin: config.clkPin }));
    localStorage.setItem(LocalStorageKeys.DefaultBrightness, JSON.stringify(config.defaultBrightness));
    localStorage.setItem(LocalStorageKeys.Inputs, JSON.stringify(config.inputs));
    localStorage.setItem(LocalStorageKeys.Faces, JSON.stringify(config.faces));
    localStorage.setItem(LocalStorageKeys.defaultFace, JSON.stringify(config.defaultFaceUuid));
  }

  private loadKey<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }

  addFace(face: FaceData): void {
    this.updateFaces([...this.faces(), face]);
  }

  updateFace(face: FaceData): void {
    this.updateFaces(this.faces().map(f => f.uuid === face.uuid ? face : f));
  }

  deleteFace(uuid: string): void {
    const current = this.config();
    const faces = current.faces.filter(f => f.uuid !== uuid);
    const defaultFaceUuid = current.defaultFaceUuid === uuid ? null : current.defaultFaceUuid;
    this.saveConfig({ ...current, faces, defaultFaceUuid });
  }

  private updateFaces(faces: FaceData[]): void {
    this.saveConfig({ ...this.config(), faces });
  }
}

export interface MatrixConfig {
  matrixes: MatrixPosition[];
  dinPin: number;
  csPin: number;
  clkPin: number;
}

export interface MatrixPosition {
  uuid: string;
  x: number;
  y: number;
  index: number;
  color: string;
  /**
   * Physical rotation of the board in degrees (clockwise).
   * Determines which side the DIN (input) connector is on:
   *   0   → DIN on left  (default)
   *   90  → DIN on bottom
   *   180 → DIN on right
   *   270 → DIN on top
   */
  rotation?: 0 | 90 | 180 | 270;
}

export interface SystemConfig {
  matrixes: MatrixPosition[];
  dinPin: number;
  csPin: number;
  clkPin: number;
  defaultBrightness: number;
  inputs: InputConfig[];
  faces: FaceData[];
  defaultFaceUuid: string | null;
}

export interface FaceData {
  uuid: string;
  name: string;
  data: number[];
  brightness?: number;
}

export enum PinMode {
  INPUT = 'input',
  INPUT_PULLUP = 'input_pullup',
  INPUT_PULLDOWN = 'input_pulldown',
}

export interface InputConfig {
  uuid: string;
  name: string;
  pin: number;
  mode: PinMode;
  invert: boolean;
  actions: Action[];
}

export type ActionType = "face";

export interface Action {
  uuid: string;
  type: ActionType;
}

export enum FaceTriggerMode {
  // Switch to this face and stay
  Permanent = 'permanent',
  // Switch while input is active then revert back to last permanent face or the default face
  Hold = 'hold',
  // Switch to this face for a fixed duration, then revert back to last permanent face or the default face
  Timer = 'timer',
}

export interface FaceAction extends Action {
  type: "face";
  faceUuid: string;
  mode: FaceTriggerMode;
  duration: number; // milliseconds, only relevant for Timer mode
}
