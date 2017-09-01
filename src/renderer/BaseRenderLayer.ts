import { IRenderLayer } from './Interfaces';
import { ITerminal, ITerminalOptions } from '../Interfaces';
import { COLORS } from './Color';

export abstract class BaseRenderLayer implements IRenderLayer {
  private _canvas: HTMLCanvasElement;
  protected _ctx: CanvasRenderingContext2D;
  private scaledCharWidth: number;
  private scaledCharHeight: number;

  // TODO: This will apply to all terminals, should it be per-terminal?
  private static _charAtlas: ImageBitmap;
  private static _charAtlasCharWidth: number;
  private static _charAtlasCharHeight: number;
  private static _charAtlasGenerator: CharAtlasGenerator;

  constructor(container: HTMLElement, id: string, zIndex: number) {
    this._canvas = document.createElement('canvas');
    this._canvas.id = `xterm-${id}-layer`;
    this._canvas.style.zIndex = zIndex.toString();
    this._ctx = this._canvas.getContext('2d');
    this._ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    container.appendChild(this._canvas);

    if (!BaseRenderLayer._charAtlasGenerator) {
      BaseRenderLayer._charAtlasGenerator = new CharAtlasGenerator();
    }
  }

    // TODO: Should this do anything?
  public onOptionsChanged(options: ITerminal): void {}
  public onCursorMove(options: ITerminal): void {}

  public resize(terminal: ITerminal, canvasWidth: number, canvasHeight: number, charSizeChanged: boolean): void {
    this.scaledCharWidth = terminal.charMeasure.width * window.devicePixelRatio;
    this.scaledCharHeight = terminal.charMeasure.height * window.devicePixelRatio;
    this._canvas.width = canvasWidth * window.devicePixelRatio;
    this._canvas.height = canvasHeight * window.devicePixelRatio;
    this._canvas.style.width = `${canvasWidth}px`;
    this._canvas.style.height = `${canvasHeight}px`;

    if (charSizeChanged) {
      // Only update the char atlas if an update for the right dimensions is not
      // already in progress
      if (BaseRenderLayer._charAtlasCharWidth !== terminal.charMeasure.width ||
          BaseRenderLayer._charAtlasCharHeight !== terminal.charMeasure.height) {
        BaseRenderLayer._charAtlas = null;
        BaseRenderLayer._charAtlasCharWidth = terminal.charMeasure.width;
        BaseRenderLayer._charAtlasCharHeight = terminal.charMeasure.height;
        BaseRenderLayer._charAtlasGenerator.generate(terminal, this.scaledCharWidth, this.scaledCharHeight).then(bitmap => {
          BaseRenderLayer._charAtlas = bitmap;
        });
      }
    }
  }

  public abstract reset(terminal: ITerminal): void;

  protected fillCells(startCol: number, startRow: number, colWidth: number, colHeight: number): void {
    this._ctx.fillRect(startCol * this.scaledCharWidth, startRow * this.scaledCharHeight, colWidth * this.scaledCharWidth, colHeight * this.scaledCharHeight);
  }

  protected fillBottomLineAtCell(x: number, y: number): void {
    this._ctx.fillRect(
        x * this.scaledCharWidth,
        (y + 1) * this.scaledCharHeight - window.devicePixelRatio - 1 /* Ensure it's drawn within the cell */,
        this.scaledCharWidth,
        window.devicePixelRatio);
  }

  protected fillLeftLineAtCell(x: number, y: number): void {
    this._ctx.fillRect(
        x * this.scaledCharWidth,
        y * this.scaledCharHeight,
        window.devicePixelRatio,
        this.scaledCharHeight);
  }

  protected clearAll(): void {
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
  }

  protected clearCells(startCol: number, startRow: number, colWidth: number, colHeight: number): void {
    this._ctx.clearRect(startCol * this.scaledCharWidth, startRow * this.scaledCharHeight, colWidth * this.scaledCharWidth, colHeight * this.scaledCharHeight);
  }

  protected drawChar(terminal: ITerminal, char: string, code: number, fg: number, x: number, y: number): void {
    let colorIndex = 0;
    if (fg < 256) {
      colorIndex = fg + 1;
    }
    if (code < 256 && (colorIndex > 0 || fg > 255)) {
      // ImageBitmap's draw about twice as fast as from a canvas
      this._ctx.drawImage(BaseRenderLayer._charAtlas,
          code * this.scaledCharWidth, colorIndex * this.scaledCharHeight, this.scaledCharWidth, this.scaledCharHeight,
          x * this.scaledCharWidth, y * this.scaledCharHeight, this.scaledCharWidth, this.scaledCharHeight);
    } else {
      this._drawUncachedChar(terminal, char, fg, x, y, this.scaledCharWidth, this.scaledCharHeight);
    }
    // This draws the atlas (for debugging purposes)
    // this._ctx.drawImage(BaseRenderLayer._charAtlas, 0, 0);
  }

  private _drawUncachedChar(terminal: ITerminal, char: string, fg: number, x: number, y: number, scaledCharWidth: number, scaledCharHeight: number): void {
    this._ctx.save();
    this._ctx.font = `${terminal.options.fontSize * window.devicePixelRatio}px ${terminal.options.fontFamily}`;
    this._ctx.textBaseline = 'top';

    // 256 color support
    if (fg < 256) {
      this._ctx.fillStyle = COLORS[fg];
    } else {
      this._ctx.fillStyle = '#ffffff';
    }

    // TODO: Do we care about width for rendering wide chars?
    this._ctx.fillText(char, x * scaledCharWidth, y * scaledCharHeight);
    this._ctx.restore();
  }
}

class CharAtlasGenerator {
  private _canvas: HTMLCanvasElement;
  private _ctx: CanvasRenderingContext2D;

  constructor() {
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
    this._ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  public generate(terminal: ITerminal, scaledCharWidth: number, scaledCharHeight: number): Promise<ImageBitmap> {
    this._canvas.width = 255 * scaledCharWidth;
    this._canvas.height = (/*default*/1 + /*0-15*/16) * scaledCharHeight;

    this._ctx.save();
    this._ctx.fillStyle = '#ffffff';
    this._ctx.font = `${terminal.options.fontSize * window.devicePixelRatio}px ${terminal.options.fontFamily}`;
    this._ctx.textBaseline = 'top';

    // Default color
    for (let i = 0; i < 256; i++) {
      this._ctx.fillText(String.fromCharCode(i), i * scaledCharWidth, 0);
    }

    // Colors 0-15
    for (let colorIndex = 0; colorIndex < 16; colorIndex++) {
      // colors 8-15 are bold
      if (colorIndex === 8) {
        this._ctx.font = `bold ${this._ctx.font}`;
      }
      const y = (colorIndex + 1) * scaledCharHeight;
      // Clear rectangle as some fonts seem to draw over the bottom boundary
      this._ctx.clearRect(0, y, this._canvas.width, scaledCharHeight);
      // Draw ascii characters
      for (let i = 0; i < 256; i++) {
        this._ctx.fillStyle = COLORS[colorIndex];
        this._ctx.fillText(String.fromCharCode(i), i * scaledCharWidth, y);
      }
    }
    this._ctx.restore();

    const charAtlasImageData = this._ctx.getImageData(0, 0, this._canvas.width, this._canvas.height);
    const promise = window.createImageBitmap(charAtlasImageData);
    // Clear the rect while the promise is in progress
    this._ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
    return promise;
  }
}
