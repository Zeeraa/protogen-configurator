import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { uuidv7 } from 'uuidv7';
import { ConfigurationService, FaceData } from '../../../core/services/configuration-service';
import { LedMatrixCanvas } from '../../components/led-matrix-canvas/led-matrix-canvas';

@Component({
  selector: 'app-faces-page',
  imports: [LedMatrixCanvas],
  templateUrl: './faces-page.html',
  styleUrl: './faces-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FacesPage {
  private readonly router = inject(Router);
  protected readonly configService = inject(ConfigurationService);

  protected addFace(): void {
    const matrixCount = this.configService.config().matrixes.length;
    const dataSize = Math.max(32, matrixCount * 8);
    const face: FaceData = {
      uuid: uuidv7(),
      name: 'New face',
      data: new Array(dataSize).fill(0),
    };
    this.configService.addFace(face);
  }

  protected editFace(face: FaceData): void {
    this.router.navigate(['/faces', face.uuid]);
  }
}
