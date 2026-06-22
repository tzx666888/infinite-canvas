"use client";

export type ImageCropRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type ImageAngleTransform = {
    horizontalAngle: number;
    pitchAngle: number;
    cameraDistance: number;
    wideAngle: boolean;
};

export type ImageUpscaleAlgorithm = "nearest" | "bilinear" | "high";

export const MAX_UPSCALE_LONG_EDGE = 4096;

export type ImageUpscaleParams = {
    targetLongEdge: number;
    algorithm: ImageUpscaleAlgorithm;
};

export type ImageSplitParams = {
    rows: number;
    columns: number;
};

export type ImageSplitPiece = {
    row: number;
    column: number;
    dataUrl: string;
};

export type MaskedEditCropData = {
    x: number;
    y: number;
    width: number;
    height: number;
    originalWidth: number;
    originalHeight: number;
    sourceDataUrl: string;
    maskDataUrl: string;
};

export async function cropDataUrl(dataUrl: string, crop?: ImageCropRect) {
    const image = await loadImage(dataUrl);
    if (crop) {
        return drawCrop(image, Math.floor(crop.x * image.width), Math.floor(crop.y * image.height), Math.ceil(crop.width * image.width), Math.ceil(crop.height * image.height));
    }
    const size = Math.min(image.width, image.height);
    const sx = Math.max(0, Math.floor((image.width - size) / 2));
    const sy = Math.max(0, Math.floor((image.height - size) / 2));
    return drawCrop(image, sx, sy, size, size);
}

export async function splitDataUrl(dataUrl: string, params: ImageSplitParams): Promise<ImageSplitPiece[]> {
    const image = await loadImage(dataUrl);
    const rows = Math.max(1, Math.floor(params.rows));
    const columns = Math.max(1, Math.floor(params.columns));
    const pieces: ImageSplitPiece[] = [];

    for (let row = 0; row < rows; row += 1) {
        const sy = Math.floor((row * image.height) / rows);
        const sh = Math.floor(((row + 1) * image.height) / rows) - sy;
        for (let column = 0; column < columns; column += 1) {
            const sx = Math.floor((column * image.width) / columns);
            const sw = Math.floor(((column + 1) * image.width) / columns) - sx;
            pieces.push({ row, column, dataUrl: drawCrop(image, sx, sy, sw, sh) });
        }
    }

    return pieces;
}

export async function transformAngleDataUrl(dataUrl: string, params: ImageAngleTransform) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    const padding = Math.round(Math.max(image.width, image.height) * 0.18);
    canvas.width = image.width + padding * 2;
    canvas.height = image.height + padding * 2;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.clearRect(0, 0, canvas.width, canvas.height);

    const horizontal = params.horizontalAngle / 60;
    const pitch = params.pitchAngle / 45;
    const distanceScale = 1.12 - params.cameraDistance * 0.035;
    const wideScale = params.wideAngle ? 0.88 : 1;
    const scale = Math.max(0.64, Math.min(1.1, distanceScale * wideScale));
    const width = image.width * scale * (1 - Math.abs(horizontal) * 0.28);
    const height = image.height * scale * (1 - Math.abs(pitch) * 0.18);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const skewX = horizontal * image.width * 0.18;
    const skewY = pitch * image.height * 0.12;
    const x = cx - width / 2 + horizontal * padding * 0.5;
    const y = cy - height / 2 + pitch * padding * 0.45;

    context.save();
    context.setTransform(1, pitch * 0.08, horizontal * -0.1, 1, 0, 0);
    context.drawImage(image, x + skewX, y + skewY, width, height);
    context.restore();

    if (params.wideAngle) {
        const gradient = context.createRadialGradient(cx, cy, Math.min(canvas.width, canvas.height) * 0.2, cx, cy, Math.max(canvas.width, canvas.height) * 0.62);
        gradient.addColorStop(0, "rgba(255,255,255,0)");
        gradient.addColorStop(1, "rgba(0,0,0,0.18)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    return canvas.toDataURL("image/png");
}

export async function upscaleDataUrl(dataUrl: string, params: ImageUpscaleParams) {
    const image = await loadImage(dataUrl);
    const { width, height } = resolveUpscaleSize(image.width, image.height, params.targetLongEdge);
    return params.algorithm === "high" ? drawStepUpscale(image, width, height) : drawResize(image, image.width, image.height, width, height, params.algorithm);
}

export async function applyMaskedEditDataUrl(sourceDataUrl: string, generatedDataUrl: string, maskDataUrl: string) {
    const [source, generated, mask] = await Promise.all([loadImage(sourceDataUrl), loadImage(generatedDataUrl), loadImage(maskDataUrl)]);
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const generatedLayer = document.createElement("canvas");
    generatedLayer.width = width;
    generatedLayer.height = height;
    const generatedContext = generatedLayer.getContext("2d");
    if (!generatedContext) throw new Error("无法读取局部修改结果");
    generatedContext.imageSmoothingEnabled = true;
    generatedContext.imageSmoothingQuality = "high";
    generatedContext.drawImage(generated, 0, 0, width, height);
    return compositeMaskedLayer(source, generatedLayer, mask, width, height);
}

export async function prepareMaskedEditCropDataUrls(sourceDataUrl: string, maskDataUrl: string): Promise<MaskedEditCropData> {
    const [source, mask] = await Promise.all([loadImage(sourceDataUrl), loadImage(maskDataUrl)]);
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!maskContext) throw new Error("无法读取局部修改蒙版");
    maskContext.drawImage(mask, 0, 0, width, height);
    const pixels = maskContext.getImageData(0, 0, width, height).data;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const selected = pixels[(y * width + x) * 4 + 3] < 128;
            if (!selected) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (maxX < minX || maxY < minY) throw new Error("请先涂抹局部区域");

    const selectedWidth = maxX - minX + 1;
    const selectedHeight = maxY - minY + 1;
    const padding = Math.max(32, Math.round(Math.max(selectedWidth, selectedHeight) * 0.45), Math.round(Math.max(width, height) * 0.025));
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);
    const right = Math.min(width, maxX + padding + 1);
    const bottom = Math.min(height, maxY + padding + 1);
    const cropWidth = Math.max(1, right - x);
    const cropHeight = Math.max(1, bottom - y);

    return {
        x,
        y,
        width: cropWidth,
        height: cropHeight,
        originalWidth: width,
        originalHeight: height,
        sourceDataUrl: drawSourceCrop(source, x, y, cropWidth, cropHeight),
        maskDataUrl: drawSourceCrop(maskCanvas, x, y, cropWidth, cropHeight),
    };
}

export async function applyMaskedEditCropDataUrl(sourceDataUrl: string, generatedDataUrl: string, maskDataUrl: string, crop: Pick<MaskedEditCropData, "x" | "y" | "width" | "height">) {
    const [source, generated, mask] = await Promise.all([loadImage(sourceDataUrl), loadImage(generatedDataUrl), loadImage(maskDataUrl)]);
    const width = source.naturalWidth || source.width;
    const height = source.naturalHeight || source.height;
    const generatedLayer = document.createElement("canvas");
    generatedLayer.width = width;
    generatedLayer.height = height;
    const generatedContext = generatedLayer.getContext("2d");
    if (!generatedContext) throw new Error("无法读取局部修改结果");
    generatedContext.imageSmoothingEnabled = true;
    generatedContext.imageSmoothingQuality = "high";
    generatedContext.drawImage(generated, crop.x, crop.y, crop.width, crop.height);
    return compositeMaskedLayer(source, generatedLayer, mask, width, height);
}

function compositeMaskedLayer(source: HTMLImageElement, generatedLayer: HTMLCanvasElement, mask: HTMLImageElement, width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法合成局部修改结果");
    context.drawImage(source, 0, 0, width, height);
    const generatedContext = generatedLayer.getContext("2d");
    if (!generatedContext) throw new Error("无法读取局部修改结果");

    const rawSelection = document.createElement("canvas");
    rawSelection.width = width;
    rawSelection.height = height;
    const rawContext = rawSelection.getContext("2d", { willReadFrequently: true });
    if (!rawContext) throw new Error("无法读取局部修改蒙版");
    rawContext.drawImage(mask, 0, 0, width, height);
    const maskPixels = rawContext.getImageData(0, 0, width, height);
    const selectionPixels = rawContext.createImageData(width, height);
    for (let index = 0; index < maskPixels.data.length; index += 4) {
        const selected = maskPixels.data[index + 3] < 128;
        selectionPixels.data[index] = 255;
        selectionPixels.data[index + 1] = 255;
        selectionPixels.data[index + 2] = 255;
        selectionPixels.data[index + 3] = selected ? 255 : 0;
    }
    rawContext.putImageData(selectionPixels, 0, 0);

    const featheredSelection = document.createElement("canvas");
    featheredSelection.width = width;
    featheredSelection.height = height;
    const featheredContext = featheredSelection.getContext("2d", { willReadFrequently: true });
    if (!featheredContext) throw new Error("无法处理局部修改边缘");
    const featherRadius = Math.max(3, Math.min(24, Math.round(Math.max(width, height) / 450)));
    featheredContext.filter = `blur(${featherRadius}px)`;
    featheredContext.drawImage(rawSelection, 0, 0);
    featheredContext.filter = "none";
    const featheredPixels = featheredContext.getImageData(0, 0, width, height);
    for (let index = 3; index < featheredPixels.data.length; index += 4) {
        if (selectionPixels.data[index] === 0) featheredPixels.data[index] = 0;
    }
    featheredContext.putImageData(featheredPixels, 0, 0);

    generatedContext.globalCompositeOperation = "destination-in";
    generatedContext.drawImage(featheredSelection, 0, 0);
    generatedContext.globalCompositeOperation = "source-over";
    context.drawImage(generatedLayer, 0, 0);
    return canvas.toDataURL("image/png");
}

export function resolveUpscaleSize(width: number, height: number, targetLongEdge: number) {
    const longEdge = Math.max(1, width, height);
    const target = Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(targetLongEdge)));
    const scale = target / longEdge;
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function drawCrop(image: HTMLImageElement, sx: number, sy: number, sw: number, sh: number) {
    return drawSourceCrop(image, sx, sy, sw, sh);
}

function drawSourceCrop(image: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, sw);
    canvas.height = Math.max(1, sh);
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

function drawStepUpscale(image: HTMLImageElement, width: number, height: number) {
    let source: CanvasImageSource = image;
    let sourceWidth = image.width;
    let sourceHeight = image.height;

    while (sourceWidth * 2 < width && sourceHeight * 2 < height) {
        const nextWidth = sourceWidth * 2;
        const nextHeight = sourceHeight * 2;
        const next = drawResizeCanvas(source, sourceWidth, sourceHeight, nextWidth, nextHeight, "high");
        source = next;
        sourceWidth = nextWidth;
        sourceHeight = nextHeight;
    }

    return drawResize(source, sourceWidth, sourceHeight, width, height, "high");
}

function drawResize(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    return drawResizeCanvas(source, sourceWidth, sourceHeight, width, height, algorithm).toDataURL("image/png");
}

function drawResizeCanvas(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number, algorithm: ImageUpscaleAlgorithm) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    context.imageSmoothingEnabled = algorithm !== "nearest";
    context.imageSmoothingQuality = algorithm === "bilinear" ? "medium" : "high";
    context.drawImage(source, 0, 0, sourceWidth, sourceHeight, 0, 0, width, height);
    return canvas;
}

function loadImage(dataUrl: string) {
    return new Promise<HTMLImageElement>((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.src = dataUrl;
    });
}
