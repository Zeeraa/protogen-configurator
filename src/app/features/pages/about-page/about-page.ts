import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-about-page',
  imports: [RouterLink],
  templateUrl: './about-page.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './about-page.scss',
})
export class AboutPage {}
