import sharp from "sharp";
export function aspectToCanvas(aspectRatio, resolution) {
    const base = resolution === "720p" ? 720 : 480;
    const ratios = {
        "16:9": [16, 9], "9:16": [9, 16], "4:3": [4, 3], "3:4": [3, 4],
        "3:2": [3, 2], "2:3": [2, 3], "1:1": [1, 1], "auto": [16, 9],
    };
    const [w, h] = ratios[aspectRatio] || [16, 9];
    if (w >= h)
        return { width: Math.round(base * w / h), height: base };
    return { width: base, height: Math.round(base * h / w) };
}
export async function generateWhiteCanvasB64(width, height) {
    const buffer = await sharp({
        create: {
            width,
            height,
            channels: 3,
            background: "#ffffff",
        },
    })
        .png()
        .toBuffer();
    return buffer.toString("base64");
}
