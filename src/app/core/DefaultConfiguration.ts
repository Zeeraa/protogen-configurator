import { uuidv4 } from 'uuidv7';
import { MatrixPosition, SystemConfig } from './services/configuration-service';

export const DEFAULT_PINS = { dinPin: 11, csPin: 10, clkPin: 13 };

export const DEFAULT_MATRIXES: MatrixPosition[] = [
  { uuid: uuidv4(), index: 0,  x: 0,   y: 0,  color: '#0000FF' },
  { uuid: uuidv4(), index: 1,  x: 8,   y: 0,  color: '#0000FF' },
  { uuid: uuidv4(), index: 2,  x: 16,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 3,  x: 24,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 4,  x: 32,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 5,  x: 40,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 6,  x: 48,  y: 0,  color: '#0000FF' },
  { uuid: uuidv4(), index: 7,  x: 64,  y: 0,  color: '#0000FF' },
  { uuid: uuidv4(), index: 8,  x: 72,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 9,  x: 80,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 10, x: 88,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 11, x: 96,  y: 16, color: '#0000FF' },
  { uuid: uuidv4(), index: 12, x: 104, y: 0,  color: '#0000FF' },
  { uuid: uuidv4(), index: 13, x: 112, y: 0,  color: '#0000FF' },
];

export const DEFAULT_CONFIG: SystemConfig = { matrixes: DEFAULT_MATRIXES, inputs: [], faces: [], defaultFaceUuid: null, defaultBrightness: 8, ...DEFAULT_PINS };
