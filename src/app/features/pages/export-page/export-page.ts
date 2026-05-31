import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ArduinoCodegenService } from '../../../core/services/codegen/arduino-codegen-service';

@Component({
  selector: 'app-export-page',
  templateUrl: './export-page.html',
  styleUrl: './export-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportPage {
  private readonly arduinoCodegen = inject(ArduinoCodegenService);

  protected async exportArduino() {
    const code = await this.arduinoCodegen.generateArduinoCode();

    if(code == null) {
      return;
    }

    this.downloadFile('protogen.ino', code);
  }

  private downloadFile(filename: string, content: string) {
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
