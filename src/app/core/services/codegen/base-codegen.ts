/**
 * Abstract base class for code-generation services.
 * Provides shared utilities for working with LED panel bitmasks.
 */
export abstract class BaseCodegen {
  /** Escapes a string for safe embedding inside a C/C++ string literal. */
  protected escapeCString(str: string): string {
    return str
      .replace(/\\/g, '\\\\')
      .replace(/"/g,  '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  /**
   * Rotates an 8×8 LED bitmask clockwise by `degrees`.
   *
   * Storage format (same as `drawData` in `LedMatrixCanvas`):
   *   w0 — rows 0-3: bit position = row * 8 + col
   *   w1 — rows 4-7: bit position = (row - 4) * 8 + col
   *
   * Returns the rotated `[w0, w1]` pair.
   */
  protected rotateBitmask(
    w0: number,
    w1: number,
    degrees: 0 | 90 | 180 | 270,
  ): [number, number] {
    if (degrees === 0) return [w0 >>> 0, w1 >>> 0];

    // Decode flat grid
    const grid: boolean[][] = Array.from({ length: 8 }, (_, row) =>
      Array.from({ length: 8 }, (__, col) => {
        const bit = row * 8 + col;
        const w = bit < 32 ? w0 : w1;
        return !!((w >>> (bit % 32)) & 1);
      }),
    );

    // Rotate grid
    const rotated: boolean[][] = Array.from({ length: 8 }, () =>
      new Array<boolean>(8).fill(false),
    );
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        let newRow: number;
        let newCol: number;
        switch (degrees) {
          case 90:  newRow = col;     newCol = 7 - row; break;
          case 180: newRow = 7 - row; newCol = 7 - col; break;
          case 270: newRow = 7 - col; newCol = row;     break;
        }
        rotated[newRow!][newCol!] = grid[row][col];
      }
    }

    // Encode back
    let rw0 = 0;
    let rw1 = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        if (rotated[row][col]) {
          const bit = row * 8 + col;
          if (bit < 32) rw0 |= (1 << bit);
          else          rw1 |= (1 << (bit - 32));
        }
      }
    }
    return [rw0 >>> 0, rw1 >>> 0];
  }

  /**
   * Flips an 8×8 bitmask vertically (top↔bottom, columns preserved).
   * Used to cancel the MAX7219 hardware's intrinsic vertical-flip behaviour.
   */
  protected flipBitmaskVertical(w0: number, w1: number): [number, number] {
    // Decode
    const rows: number[] = Array.from({ length: 8 }, (_, row) => {
      const w = row < 4 ? w0 : w1;
      return (w >>> ((row % 4) * 8)) & 0xFF;
    });

    // Flip row order
    const flipped = [...rows].reverse();

    // Encode
    let rw0 = 0;
    let rw1 = 0;
    for (let row = 0; row < 8; row++) {
      const byte = flipped[row] & 0xFF;
      if (row < 4) rw0 |= byte << (row * 8);
      else         rw1 |= byte << ((row - 4) * 8);
    }
    return [rw0 >>> 0, rw1 >>> 0];
  }

  /**
   * Applies the full board correction to a bitmask:
   * 1. Vertically flips the data to cancel the MAX7219's intrinsic VFlip.
   * 2. Rotates counter-clockwise by `boardRotation` degrees to cancel the
   *    physical board rotation.
   */
  protected applyBoardCorrection(
    w0: number,
    w1: number,
    boardRotation: 0 | 90 | 180 | 270,
  ): [number, number] {
    const [fw0, fw1] = this.flipBitmaskVertical(w0, w1);
    const ccw = ((360 - boardRotation) % 360) as 0 | 90 | 180 | 270;
    return this.rotateBitmask(fw0, fw1, ccw);
  }
}
