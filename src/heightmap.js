import { createNoise2D } from 'simplex-noise';

export function pixelBrightness(red, green, blue, alpha = 255) {
  return ((0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255) * (alpha / 255);
}

export function getSampleDimensions(width, height, maxSide = 241) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The image has invalid dimensions.');
  }
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return {
    columns: Math.max(2, Math.round(width * scale)),
    rows: Math.max(2, Math.round(height * scale)),
  };
}

export function readHeightmap(image) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const { columns, rows } = getSampleDimensions(imageWidth, imageHeight);
  const canvas = document.createElement('canvas');
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, columns, rows);
  const { data } = context.getImageData(0, 0, columns, rows);
  const values = new Float32Array(columns * rows);
  for (let i = 0; i < values.length; i++) {
    const offset = i * 4;
    values[i] = pixelBrightness(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  }
  return { values, columns, rows, aspect: imageWidth / imageHeight, imageWidth, imageHeight };
}

export function createPreview(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, 512 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const gray = Math.round(pixelBrightness(...pixels.data.subarray(i, i + 4)) * 255);
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png');
}

export async function decodeImage(file) {
  if (!/\.(png|jpe?g|webp|bmp)$/i.test(file.name) || (file.type && !file.type.startsWith('image/'))) {
    throw new Error('Choose a PNG, JPG, WebP, or BMP heightmap.');
  }
  if (file.size > 30 * 1024 * 1024) {
    throw new Error('This image is too large. Choose a file under 30 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty image');
    return image;
  } catch {
    throw new Error('This image could not be opened. Try another PNG, JPG, WebP, or BMP.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createSampleHeightmap() {
  let seed = 5481;
  const noise = createNoise2D(() => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d');
  const pixels = context.createImageData(512, 512);
  const samples = new Float32Array(512 * 512);
  let maximum = 0;
  // A deterministic, synthetic ridge is also a real image input for the demo.
  for (let y = 0; y < 512; y++) {
    for (let x = 0; x < 512; x++) {
      const nx = (x / 511 - 0.5) * 2;
      const ny = (y / 511 - 0.5) * 2;
      const ridge = Math.exp(-Math.pow(ny + 0.42 * nx + 0.18 * Math.sin(nx * 5), 2) * 7);
      const envelope = Math.exp(-(nx * nx + ny * ny) * 1.8);
      let detail = 0;
      let amplitude = 0.5;
      let frequency = 2.7;
      for (let octave = 0; octave < 5; octave++) {
        detail += (1 - Math.abs(noise(nx * frequency + 4.3, ny * frequency + 9.1))) * amplitude;
        amplitude *= 0.47;
        frequency *= 2.1;
      }
      const value = 0.025 + envelope * (0.13 + ridge * 0.8) * (0.22 + detail);
      samples[y * 512 + x] = value;
      maximum = Math.max(maximum, value);
    }
  }
  for (let i = 0; i < samples.length; i++) {
    const gray = Math.round((samples[i] / maximum) * 255);
    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = gray;
    pixels.data[i * 4 + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return canvas;
}
