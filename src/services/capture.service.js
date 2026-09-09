// Screen capture via Electron desktopCapturer (main process only).
const { createServiceLogger } = require('../core/logger');

function electron() {
  try { return require('electron'); } catch (_) { return null; }
}

class CaptureService {
  constructor() {
    this.log = createServiceLogger('CAPTURE');
    this.busy = false;
  }

  listDisplays() {
    const e = electron();
    if (!e) throw new Error('Capture unavailable outside Electron');
    try {
      const displays = e.screen.getAllDisplays().map((d) => ({
        id: d.id, bounds: d.bounds, size: d.size, scaleFactor: d.scaleFactor,
      }));
      return { success: true, displays };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  targetDisplay(displayId) {
    const e = electron();
    const all = e.screen.getAllDisplays();
    if (displayId == null) return e.screen.getPrimaryDisplay();
    return all.find((d) => d.id === displayId) || e.screen.getPrimaryDisplay();
  }

  async captureScreenshot({ displayId } = {}) {
    const e = electron();
    if (!e) throw new Error('Capture unavailable outside Electron');
    const display = this.targetDisplay(displayId);
    const { width, height } = display.size || { width: 1920, height: 1080 };
    const scale = display.scaleFactor || 1;
    const sources = await e.desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.floor(width * scale), height: Math.floor(height * scale) },
    });
    if (!sources.length) throw new Error('No screen sources available');
    let source = sources[0];
    const match = sources.find((s) => {
      const sz = s.thumbnail.getSize();
      return Math.abs(sz.width - width * scale) < 4 && Math.abs(sz.height - height * scale) < 4;
    });
    if (match) source = match;
    return { image: source.thumbnail, display, sourceName: source.name };
  }

  // area: { x, y, width, height } in screen (dip) coordinates.
  async captureAndProcess({ displayId, area } = {}) {
    if (this.busy) throw new Error('Capture already in progress');
    this.busy = true;
    const start = Date.now();
    try {
      const { image, display } = await this.captureScreenshot({ displayId });
      const size = image.getSize();
      const dispW = (display.bounds && display.bounds.width) || (display.size && display.size.width) || size.width;
      const dispH = (display.bounds && display.bounds.height) || (display.size && display.size.height) || size.height;
      let finalImage = image;
      if (area && area.width > 4 && area.height > 4) {
        const sx = size.width / dispW;
        const sy = size.height / dispH;
        const ox = (display.bounds && display.bounds.x) || 0;
        const oy = (display.bounds && display.bounds.y) || 0;
        const rect = {
          x: Math.max(0, Math.floor((area.x - ox) * sx)),
          y: Math.max(0, Math.floor((area.y - oy) * sy)),
          width: Math.floor(area.width * sx),
          height: Math.floor(area.height * sy),
        };
        rect.width = Math.min(rect.width, size.width - rect.x);
        rect.height = Math.min(rect.height, size.height - rect.y);
        if (rect.width > 4 && rect.height > 4) {
          try { finalImage = image.crop(rect); } catch (err) { this.log.warn('Crop failed, using full image', { error: err.message }); }
        }
      }
      const buffer = finalImage.toPNG();
      const dims = finalImage.getSize();
      this.log.logPerformance('Screenshot capture', start, { bytes: buffer.length, dims });
      return {
        imageBuffer: buffer, mimeType: 'image/png', width: dims.width, height: dims.height,
        metadata: { timestamp: new Date().toISOString(), processingMs: Date.now() - start },
      };
    } finally {
      this.busy = false;
    }
  }
}

module.exports = new CaptureService();
