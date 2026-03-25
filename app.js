const pdfInput = document.getElementById("pdfInput");
const pdfDropZone = document.getElementById("pdfDropZone");
const uploadLabel = document.getElementById("uploadLabel");
const imageInput = document.getElementById("imageInput");
const imageLabel = document.getElementById("imageLabel");
const statusEl = document.getElementById("status");
const pageHint = document.getElementById("pageHint");
const editor = document.getElementById("editor");
const downloadBtn = document.getElementById("downloadBtn");
const rerenderBtn = document.getElementById("rerenderBtn");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const toggleSignatureBtn = document.getElementById("toggleSignatureBtn");
const signaturePanel = document.getElementById("signaturePanel");
const signatureCanvas = document.getElementById("signatureCanvas");
const clearSignatureBtn = document.getElementById("clearSignatureBtn");
const addSignatureBtn = document.getElementById("addSignatureBtn");

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const state = {
  originalBytes: null,
  fileName: "edited.pdf",
  pdfDoc: null,
  pages: [],
  scale: Number(zoomRange.value) / 100,
  isRendering: false,
  selectedPageIndex: null,
  assets: [],
  activeAssetId: null,
  assetCounter: 0,
  sourcePdfName: "",
};

const signaturePad = {
  drawing: false,
  drawn: false,
  ctx: signatureCanvas.getContext("2d"),
};

initializeSignaturePad();
setToolsEnabled(false);
setupPdfDragAndDrop();

pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  await loadPdfFile(file);
});

imageInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith("image/")) {
    setStatus("Please choose a valid image file.", true);
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    imageLabel.textContent = file.name;
    await addAssetFromDataUrl(dataUrl, "image");
  } catch (error) {
    console.error(error);
    setStatus("Could not load image file.", true);
  } finally {
    imageInput.value = "";
  }
});

zoomRange.addEventListener("input", () => {
  zoomValue.textContent = `${zoomRange.value}%`;
  rerenderBtn.disabled = !state.originalBytes;
});

rerenderBtn.addEventListener("click", async () => {
  if (!state.originalBytes) {
    return;
  }

  state.scale = Number(zoomRange.value) / 100;
  await renderCurrentPdf();
});

toggleSignatureBtn.addEventListener("click", () => {
  const isHidden = signaturePanel.classList.toggle("hidden");
  toggleSignatureBtn.textContent = isHidden ? "Signature Pad" : "Hide Signature Pad";
});

clearSignatureBtn.addEventListener("click", () => {
  clearSignatureCanvas();
  setStatus("Signature pad cleared.");
});

addSignatureBtn.addEventListener("click", async () => {
  const trimmed = getTrimmedSignatureDataUrl();
  if (!trimmed) {
    setStatus("Draw your signature first.", true);
    return;
  }

  await addAssetFromDataUrl(trimmed, "signature");
});

downloadBtn.addEventListener("click", async () => {
  if (!state.originalBytes || state.pages.length === 0) {
    return;
  }

  downloadBtn.disabled = true;
  setStatus("Building edited PDF...");

  try {
    const editedBytes = await buildEditedPdf();
    triggerDownload(editedBytes, state.fileName);
    setStatus("Done. Your edited PDF has been downloaded.");
  } catch (error) {
    console.error(error);
    setStatus("Could not generate the edited PDF.", true);
  } finally {
    downloadBtn.disabled = false;
  }
});

async function renderCurrentPdf() {
  if (!state.originalBytes || state.isRendering) {
    return;
  }

  state.isRendering = true;
  downloadBtn.disabled = true;
  rerenderBtn.disabled = true;
  clearEditor();
  setStatus("Rendering PDF pages...");

  try {
    const loadingTask = pdfjsLib.getDocument({ data: state.originalBytes.slice(0) });
    state.pdfDoc = await loadingTask.promise;

    for (let pageIndex = 0; pageIndex < state.pdfDoc.numPages; pageIndex += 1) {
      setStatus(`Rendering page ${pageIndex + 1} of ${state.pdfDoc.numPages}...`);
      const page = await state.pdfDoc.getPage(pageIndex + 1);
      const pageRecord = await renderPage(page, pageIndex);
      state.pages.push(pageRecord);
    }

    if (state.pages.length > 0) {
      if (
        state.selectedPageIndex === null ||
        state.selectedPageIndex < 0 ||
        state.selectedPageIndex >= state.pages.length
      ) {
        state.selectedPageIndex = 0;
      }
      setSelectedPage(state.selectedPageIndex);
      renderStoredAssets();
    }

    const totalEditable = state.pages.reduce((sum, page) => sum + page.items.length, 0);
    if (totalEditable === 0) {
      setStatus("No editable text found. You can still add picture/signature and download.");
    } else {
      setStatus(
        `Ready. Edit ${totalEditable} text fields, add pictures/signatures, then download.`
      );
    }

    setToolsEnabled(true);
    downloadBtn.disabled = false;
  } catch (error) {
    console.error(error);
    setStatus("Unable to read this PDF file.", true);
    setToolsEnabled(false);
  } finally {
    state.isRendering = false;
    rerenderBtn.disabled = !state.originalBytes;
  }
}

async function loadPdfFile(file) {
  if (!isPdfFile(file)) {
    setStatus("Please upload a PDF file.", true);
    return;
  }

  state.sourcePdfName = file.name;
  updateUploadLabel();
  imageLabel.textContent = "Add Picture";
  state.fileName = file.name.replace(/\.pdf$/i, "") + "-edited.pdf";
  state.originalBytes = await file.arrayBuffer();
  state.assets = [];
  state.assetCounter = 0;
  state.activeAssetId = null;
  state.selectedPageIndex = 0;
  clearSignatureCanvas();

  await renderCurrentPdf();
}

function setupPdfDragAndDrop() {
  let dragDepth = 0;

  const preventDragDefaults = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  document.addEventListener("dragenter", (event) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }
    preventDragDefaults(event);
    dragDepth += 1;
    setUploadDropState(true);
  });

  document.addEventListener("dragover", (event) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }
    preventDragDefaults(event);
  });

  document.addEventListener("dragleave", (event) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }
    preventDragDefaults(event);
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      setUploadDropState(false);
    }
  });

  document.addEventListener("drop", async (event) => {
    if (!hasFilePayload(event.dataTransfer)) {
      return;
    }
    preventDragDefaults(event);
    dragDepth = 0;
    setUploadDropState(false);

    const droppedFile = pickFirstFile(event.dataTransfer);
    if (!droppedFile) {
      setStatus("No file detected. Try dropping a PDF file.", true);
      return;
    }

    await loadPdfFile(droppedFile);
  });
}

function setUploadDropState(isActive) {
  if (pdfDropZone) {
    pdfDropZone.classList.toggle("dragover", isActive);
  }
  document.body.classList.toggle("pdf-dragover", isActive);

  if (isActive) {
    uploadLabel.textContent = "Drop PDF here";
  } else {
    updateUploadLabel();
  }
}

function updateUploadLabel() {
  uploadLabel.textContent = state.sourcePdfName || "Upload PDF";
}

function hasFilePayload(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }

  const files = Array.from(dataTransfer.files || []);
  if (files.length > 0) {
    return true;
  }

  const items = Array.from(dataTransfer.items || []);
  return items.some((item) => item.kind === "file");
}

function pickFirstFile(dataTransfer) {
  if (!dataTransfer) {
    return null;
  }
  const files = Array.from(dataTransfer.files || []);
  return files[0] || null;
}

function isPdfFile(file) {
  if (!file) {
    return false;
  }
  const type = (file.type || "").toLowerCase();
  return type === "application/pdf" || /\.pdf$/i.test(file.name || "");
}

async function renderPage(page, pageIndex) {
  const viewport = page.getViewport({ scale: state.scale });
  const outputScale = window.devicePixelRatio || 1;

  const pageCard = document.createElement("article");
  pageCard.className = "page-card";

  const pageLabel = document.createElement("p");
  pageLabel.className = "page-label";
  pageLabel.textContent = `Page ${pageIndex + 1}`;

  const pageScroll = document.createElement("div");
  pageScroll.className = "page-scroll";

  const pageWrap = document.createElement("div");
  pageWrap.className = "page-wrap";
  pageWrap.style.width = `${viewport.width}px`;
  pageWrap.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.className = "page-canvas";
  canvas.width = Math.max(1, Math.ceil(viewport.width * outputScale));
  canvas.height = Math.max(1, Math.ceil(viewport.height * outputScale));
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({
    canvasContext,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  }).promise;

  const textLayer = document.createElement("div");
  textLayer.className = "text-layer";

  const assetLayer = document.createElement("div");
  assetLayer.className = "asset-layer";

  pageWrap.append(canvas, textLayer, assetLayer);
  pageScroll.append(pageWrap);
  pageCard.append(pageLabel, pageScroll);

  pageCard.addEventListener("pointerdown", () => {
    setSelectedPage(pageIndex);
  });

  if (editor.classList.contains("empty")) {
    editor.innerHTML = "";
    editor.classList.remove("empty");
  }

  editor.append(pageCard);

  const textContent = await page.getTextContent();
  const items = [];

  for (const item of textContent.items) {
    const itemString = item.str || "";
    if (!itemString.trim()) {
      continue;
    }

    const itemStyles = textContent.styles[item.fontName] || {};
    const transformed = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const angleRad = Math.atan2(transformed[1], transformed[0]);
    const angleDeg = (angleRad * 180) / Math.PI;

    const fontSizePx = Math.max(8, Math.hypot(transformed[2], transformed[3]));
    const displayFontFamily = pickCssFontFamily(itemStyles.fontFamily, item.fontName);
    const fontTraits = deriveFontTraits(item.fontName, itemStyles.fontFamily);
    const measuredWidthPx =
      estimateTextWidthPx(
        itemString,
        fontSizePx,
        displayFontFamily,
        fontTraits.style,
        fontTraits.weight
      ) + 14;
    const maskWidthPx = Math.max(20, item.width * state.scale + 10);
    const fieldWidthPx = Math.max(20, item.width * state.scale + 10, measuredWidthPx);
    const fieldHeightPx = Math.max(16, fontSizePx * 1.25);

    const left = transformed[4];
    const top = transformed[5] - fontSizePx;

    const sampled = sampleTextAndBackgroundColor(
      canvasContext,
      left * outputScale,
      top * outputScale,
      fieldWidthPx * outputScale,
      fieldHeightPx * outputScale
    );

    const input = document.createElement("input");
    input.type = "text";
    input.className = "text-edit";
    input.value = itemString;
    input.spellcheck = false;

    input.style.left = `${left}px`;
    input.style.top = `${top}px`;
    input.style.width = `${fieldWidthPx}px`;
    input.style.height = `${fieldHeightPx}px`;
    input.style.fontSize = `${fontSizePx}px`;
    input.style.fontFamily = displayFontFamily;
    input.style.fontWeight = fontTraits.weight;
    input.style.fontStyle = fontTraits.style;
    input.style.setProperty("--field-color", sampled.textCss);
    input.style.setProperty("--field-bg", sampled.bgCss);
    input.style.setProperty("--mask-width", `${maskWidthPx}px`);
    input.style.transformOrigin = "left top";

    if (Math.abs(angleDeg) > 0.4) {
      input.style.transform = `rotate(${angleDeg}deg)`;
    }

    const itemRecord = {
      pageIndex,
      original: itemString,
      value: itemString,
      input,
      pdfX: item.transform[4],
      pdfY: item.transform[5],
      widthPdf: item.width,
      fontName: item.fontName,
      fontFamily: displayFontFamily,
      fontWeight: fontTraits.weight,
      fontStyle: fontTraits.style,
      fontSizePdf: Math.max(4, fontSizePx / state.scale),
      textColorRgb: sampled.textRgb,
      bgColorRgb: sampled.bgRgb,
      rotationDeg: angleDeg,
      baseInputWidthPx: fieldWidthPx,
      maskWidthPx,
      maskWidthPdf: maskWidthPx / state.scale,
      maskHeightPdf: fieldHeightPx / state.scale,
    };

    input.addEventListener("input", () => {
      itemRecord.value = input.value;
      fitInputWidth(input, itemRecord.baseInputWidthPx);
      syncInputVisibility(itemRecord);
    });

    input.addEventListener("focus", () => {
      syncInputVisibility(itemRecord);
    });

    input.addEventListener("blur", () => {
      syncInputVisibility(itemRecord);
    });

    textLayer.append(input);
    fitInputWidth(input, itemRecord.baseInputWidthPx);
    syncInputVisibility(itemRecord);
    items.push(itemRecord);
  }

  return {
    index: pageIndex,
    widthPdf: page.view[2],
    heightPdf: page.view[3],
    items,
    canvas,
    pageCard,
    pageWrap,
    assetLayer,
  };
}

async function addAssetFromDataUrl(dataUrl, type) {
  const pageIndex = state.selectedPageIndex;
  if (pageIndex === null || !state.pages[pageIndex]) {
    setStatus("Select a page first.", true);
    return;
  }

  const safeDataUrl = await ensureEmbeddableDataUrl(dataUrl);
  const pageRecord = state.pages[pageIndex];
  const image = await loadImage(safeDataUrl);

  let widthPdf = pageRecord.widthPdf * 0.28;
  let heightPdf = widthPdf * (image.naturalHeight / image.naturalWidth);

  const maxHeight = pageRecord.heightPdf * 0.33;
  if (heightPdf > maxHeight) {
    heightPdf = maxHeight;
    widthPdf = heightPdf * (image.naturalWidth / image.naturalHeight);
  }

  const pageAssets = state.assets.filter((asset) => asset.pageIndex === pageIndex).length;
  const xOffset = 24 + pageAssets * 10;
  const yOffset = 34 + pageAssets * 10;

  const asset = {
    id: `asset-${++state.assetCounter}`,
    type,
    pageIndex,
    dataUrl: safeDataUrl,
    pdfX: clamp(xOffset, 4, pageRecord.widthPdf - widthPdf - 4),
    pdfY: clamp(pageRecord.heightPdf - heightPdf - yOffset, 4, pageRecord.heightPdf - heightPdf - 4),
    widthPdf,
    heightPdf,
  };

  state.assets.push(asset);
  attachAssetToPage(asset, pageRecord);
  setActiveAsset(asset.id);
  setStatus(`${type === "signature" ? "Signature" : "Picture"} added. Drag/resize on page.`);
}

async function ensureEmbeddableDataUrl(dataUrl) {
  if (/^data:image\/(png|jpeg|jpg)/i.test(dataUrl)) {
    return dataUrl;
  }

  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function renderStoredAssets() {
  for (const pageRecord of state.pages) {
    pageRecord.assetLayer.innerHTML = "";
  }

  for (const asset of state.assets) {
    const pageRecord = state.pages[asset.pageIndex];
    if (!pageRecord) {
      continue;
    }
    attachAssetToPage(asset, pageRecord);
  }

  setActiveAsset(state.activeAssetId);
}

function attachAssetToPage(asset, pageRecord) {
  const pixels = assetPdfToPixels(asset, pageRecord);

  const box = document.createElement("div");
  box.className = "asset-box";
  box.dataset.assetId = asset.id;
  box.style.left = `${pixels.left}px`;
  box.style.top = `${pixels.top}px`;
  box.style.width = `${pixels.width}px`;
  box.style.height = `${pixels.height}px`;

  const img = document.createElement("img");
  img.className = "asset-preview";
  img.src = asset.dataUrl;
  img.alt = asset.type;

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "asset-remove";
  removeBtn.textContent = "x";
  removeBtn.title = "Remove";

  const resizeHandle = document.createElement("span");
  resizeHandle.className = "asset-resize";

  box.append(img, removeBtn, resizeHandle);
  pageRecord.assetLayer.append(box);
  asset.element = box;

  box.addEventListener("pointerdown", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest(".asset-remove")) {
      return;
    }
    if (event.target instanceof HTMLElement && event.target.closest(".asset-resize")) {
      return;
    }

    event.preventDefault();
    setSelectedPage(asset.pageIndex);
    setActiveAsset(asset.id);
    startDraggingAsset(event, asset, pageRecord);
  });

  removeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    removeAsset(asset.id);
  });

  resizeHandle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedPage(asset.pageIndex);
    setActiveAsset(asset.id);
    startResizingAsset(event, asset, pageRecord);
  });
}

function startDraggingAsset(pointerEvent, asset, pageRecord) {
  const startX = pointerEvent.clientX;
  const startY = pointerEvent.clientY;
  const start = assetPdfToPixels(asset, pageRecord);
  const pageWidth = pageRecord.pageWrap.clientWidth;
  const pageHeight = pageRecord.pageWrap.clientHeight;

  const onMove = (event) => {
    const nextLeft = clamp(start.left + (event.clientX - startX), 0, pageWidth - start.width);
    const nextTop = clamp(start.top + (event.clientY - startY), 0, pageHeight - start.height);
    applyAssetPixelBounds(asset, pageRecord, nextLeft, nextTop, start.width, start.height);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function startResizingAsset(pointerEvent, asset, pageRecord) {
  const startX = pointerEvent.clientX;
  const startY = pointerEvent.clientY;
  const start = assetPdfToPixels(asset, pageRecord);
  const pageWidth = pageRecord.pageWrap.clientWidth;
  const pageHeight = pageRecord.pageWrap.clientHeight;

  const onMove = (event) => {
    const nextWidth = clamp(start.width + (event.clientX - startX), 24, pageWidth - start.left);
    const nextHeight = clamp(start.height + (event.clientY - startY), 24, pageHeight - start.top);
    applyAssetPixelBounds(asset, pageRecord, start.left, start.top, nextWidth, nextHeight);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function applyAssetPixelBounds(asset, pageRecord, left, top, width, height) {
  if (asset.element) {
    asset.element.style.left = `${left}px`;
    asset.element.style.top = `${top}px`;
    asset.element.style.width = `${width}px`;
    asset.element.style.height = `${height}px`;
  }

  const scale = state.scale;
  const pdfWidth = width / scale;
  const pdfHeight = height / scale;

  asset.pdfX = left / scale;
  asset.widthPdf = pdfWidth;
  asset.heightPdf = pdfHeight;
  asset.pdfY = pageRecord.heightPdf - top / scale - pdfHeight;
}

function removeAsset(assetId) {
  const target = state.assets.find((asset) => asset.id === assetId);
  if (!target) {
    return;
  }

  if (target.element) {
    target.element.remove();
  }

  state.assets = state.assets.filter((asset) => asset.id !== assetId);
  if (state.activeAssetId === assetId) {
    state.activeAssetId = null;
  }

  setStatus("Overlay removed.");
}

function setSelectedPage(pageIndex) {
  state.selectedPageIndex = pageIndex;
  pageHint.textContent = `Selected page: ${pageIndex + 1}`;

  for (const pageRecord of state.pages) {
    const selected = pageRecord.index === pageIndex;
    pageRecord.pageCard.classList.toggle("selected", selected);
  }
}

function setActiveAsset(assetId) {
  state.activeAssetId = assetId;

  for (const asset of state.assets) {
    if (asset.element) {
      asset.element.classList.toggle("active", asset.id === assetId);
    }
  }
}

function assetPdfToPixels(asset, pageRecord) {
  const scale = state.scale;
  return {
    left: asset.pdfX * scale,
    top: (pageRecord.heightPdf - asset.pdfY - asset.heightPdf) * scale,
    width: asset.widthPdf * scale,
    height: asset.heightPdf * scale,
  };
}

async function buildEditedPdf() {
  const output = await PDFLib.PDFDocument.load(state.originalBytes.slice(0));
  const pages = output.getPages();
  const embeddedImageCache = new Map();
  const embeddedFontCache = new Map();

  for (const pageRecord of state.pages) {
    const page = pages[pageRecord.index];

    for (const item of pageRecord.items) {
      if (item.value === item.original) {
        continue;
      }

      await drawEditedText(output, page, item, embeddedFontCache);
    }
  }

  for (const asset of state.assets) {
    const page = pages[asset.pageIndex];
    if (!page) {
      continue;
    }

    const image = await resolveEmbeddedPdfImage(output, asset.dataUrl, embeddedImageCache);
    page.drawImage(image, {
      x: asset.pdfX,
      y: asset.pdfY,
      width: asset.widthPdf,
      height: asset.heightPdf,
    });
  }

  return output.save();
}

async function drawEditedText(pdfDoc, page, item, fontCache) {
  try {
    const font = await resolveEmbeddedPdfFont(pdfDoc, item, fontCache);
    if (!canFontEncodeText(font, item.value)) {
      throw new Error("Font cannot encode edited text.");
    }

    const maskPlacement = getVectorTextMaskPlacement(item, font);
    page.drawRectangle({
      x: maskPlacement.x,
      y: maskPlacement.y,
      width: maskPlacement.width,
      height: maskPlacement.height,
      color: toPdfColor(item.bgColorRgb),
      rotate: PDFLib.degrees(item.rotationDeg || 0),
      borderWidth: 0,
    });

    if (!item.value.trim()) {
      return;
    }

    page.drawText(item.value, {
      x: item.pdfX,
      y: item.pdfY,
      size: item.fontSizePdf,
      font,
      color: toPdfColor(item.textColorRgb),
      rotate: PDFLib.degrees(item.rotationDeg || 0),
    });
  } catch (error) {
    console.warn("Falling back to raster text patch for item:", item, error);
    await drawRasterTextPatch(pdfDoc, page, item);
  }
}

function buildTextPatchSpec(item) {
  const inputHeightPx =
    Number.parseFloat(item.input.style.height) ||
    Math.max(16, item.fontSizePdf * state.scale * 1.25);
  const fontSizePx =
    Number.parseFloat(item.input.style.fontSize) || Math.max(8, item.fontSizePdf * state.scale);
  const fontFamily = item.input.style.fontFamily || item.fontFamily || "sans-serif";
  const fontStyle = item.input.style.fontStyle || item.fontStyle || "normal";
  const fontWeight = item.input.style.fontWeight || item.fontWeight || "400";

  const padX = 4;
  const padTop = 3;
  const padBottom = 4;
  const patchScale = Math.max(3, Math.ceil(window.devicePixelRatio || 1));
  const measuredTextWidth =
    estimateTextWidthPx(item.value, fontSizePx, fontFamily, fontStyle, fontWeight) + padX * 2 + 4;
  const coverWidthPx = Math.max(
    1,
    Number.isFinite(item.maskWidthPx) ? item.maskWidthPx : item.widthPdf * state.scale + padX * 2
  );
  const patchWidthPx = Math.max(coverWidthPx, measuredTextWidth);
  const patchHeightPx = Math.max(inputHeightPx + padTop + padBottom, fontSizePx * 1.45);
  const baselineYPx = padTop + fontSizePx * 0.94;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(patchWidthPx * patchScale));
  canvas.height = Math.max(1, Math.ceil(patchHeightPx * patchScale));

  const ctx = canvas.getContext("2d");
  ctx.scale(patchScale, patchScale);
  ctx.fillStyle = `rgb(${item.bgColorRgb.r}, ${item.bgColorRgb.g}, ${item.bgColorRgb.b})`;
  ctx.fillRect(0, 0, coverWidthPx, patchHeightPx);

  if (item.value.trim()) {
    ctx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = `rgb(${item.textColorRgb.r}, ${item.textColorRgb.g}, ${item.textColorRgb.b})`;
    ctx.fillText(item.value, padX, baselineYPx);
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    patchWidthPx,
    patchHeightPx,
    anchorOffsetXPx: padX,
    anchorOffsetYPx: patchHeightPx - baselineYPx,
  };
}

function getTextPatchPlacement(item, patch) {
  const scale = state.scale;
  const anchorOffsetXPdf = patch.anchorOffsetXPx / scale;
  const anchorOffsetYPdf = patch.anchorOffsetYPx / scale;
  const theta = ((item.rotationDeg || 0) * Math.PI) / 180;
  const rotatedOffsetX =
    anchorOffsetXPdf * Math.cos(theta) - anchorOffsetYPdf * Math.sin(theta);
  const rotatedOffsetY =
    anchorOffsetXPdf * Math.sin(theta) + anchorOffsetYPdf * Math.cos(theta);

  return {
    x: item.pdfX - rotatedOffsetX,
    y: item.pdfY - rotatedOffsetY,
    width: patch.patchWidthPx / scale,
    height: patch.patchHeightPx / scale,
  };
}

async function resolveEmbeddedPdfImage(pdfDoc, dataUrl, imageCache) {
  if (imageCache.has(dataUrl)) {
    return imageCache.get(dataUrl);
  }

  const bytes = dataUrlToUint8Array(dataUrl);
  const isJpg = /^data:image\/(jpeg|jpg)/i.test(dataUrl);
  const embedded = isJpg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  imageCache.set(dataUrl, embedded);
  return embedded;
}

async function resolveEmbeddedPdfFont(pdfDoc, item, fontCache) {
  const standardFont = pickStandardPdfFont(item);
  if (fontCache.has(standardFont)) {
    return fontCache.get(standardFont);
  }

  const font = await pdfDoc.embedFont(standardFont);
  fontCache.set(standardFont, font);
  return font;
}

function pickStandardPdfFont(item) {
  const fontWeight = String(item.fontWeight || "").toLowerCase();
  const fontStyle = String(item.fontStyle || "").toLowerCase();
  const source = `${item.fontFamily || ""} ${item.fontName || ""}`.toLowerCase();

  const isBold =
    /bold|black|heavy|demi|semibold/.test(source) ||
    ["600", "700", "800", "900"].includes(fontWeight);
  const isItalic =
    fontStyle.includes("italic") ||
    fontStyle.includes("oblique") ||
    /italic|oblique/.test(source);
  const isMono = /courier|mono|code/.test(source);
  const isSerif = /times|georgia|serif/.test(source) && !isMono;

  if (isMono) {
    if (isBold && isItalic) return PDFLib.StandardFonts.CourierBoldOblique;
    if (isBold) return PDFLib.StandardFonts.CourierBold;
    if (isItalic) return PDFLib.StandardFonts.CourierOblique;
    return PDFLib.StandardFonts.Courier;
  }

  if (isSerif) {
    if (isBold && isItalic) return PDFLib.StandardFonts.TimesRomanBoldItalic;
    if (isBold) return PDFLib.StandardFonts.TimesRomanBold;
    if (isItalic) return PDFLib.StandardFonts.TimesRomanItalic;
    return PDFLib.StandardFonts.TimesRoman;
  }

  if (isBold && isItalic) return PDFLib.StandardFonts.HelveticaBoldOblique;
  if (isBold) return PDFLib.StandardFonts.HelveticaBold;
  if (isItalic) return PDFLib.StandardFonts.HelveticaOblique;
  return PDFLib.StandardFonts.Helvetica;
}

function canFontEncodeText(font, text) {
  try {
    font.encodeText(text || "");
    return true;
  } catch (error) {
    return false;
  }
}

function getVectorTextMaskPlacement(item, font) {
  const fontSize = item.fontSizePdf || 12;
  const ascent = font.heightAtSize(fontSize, { descender: false });
  const totalHeight = font.heightAtSize(fontSize, { descender: true });
  const descender = Math.max(0, totalHeight - ascent);
  const xPad = Math.max(0.6, fontSize * 0.04);
  const yPad = Math.max(0.4, fontSize * 0.05);
  const maskWidth = Math.max(item.maskWidthPdf || item.widthPdf || 0, item.widthPdf || 0);

  return {
    x: item.pdfX - xPad,
    y: item.pdfY - descender - yPad,
    width: maskWidth + xPad * 2,
    height: totalHeight + yPad * 2,
  };
}

async function drawRasterTextPatch(pdfDoc, page, item) {
  const patch = buildTextPatchSpec(item);
  const patchImage = await pdfDoc.embedPng(dataUrlToUint8Array(patch.dataUrl));
  const placement = getTextPatchPlacement(item, patch);

  page.drawImage(patchImage, {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
    rotate: PDFLib.degrees(item.rotationDeg || 0),
  });
}

function toPdfColor(rgb) {
  return PDFLib.rgb(
    clamp((rgb?.r ?? 0) / 255, 0, 1),
    clamp((rgb?.g ?? 0) / 255, 0, 1),
    clamp((rgb?.b ?? 0) / 255, 0, 1)
  );
}

function dataUrlToUint8Array(dataUrl) {
  const [, base64] = dataUrl.split(",");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function pickCssFontFamily(fontFamily, fontName) {
  const cleaned = normalizeFontFamily(fontFamily);
  if (cleaned) {
    return cleaned;
  }

  const source = `${fontFamily || ""} ${fontName || ""}`.toLowerCase();
  if (source.includes("times") || source.includes("serif")) {
    return "'Times New Roman', Georgia, serif";
  }
  if (source.includes("courier") || source.includes("mono")) {
    return "'Courier New', Courier, monospace";
  }
  return "Arial, Helvetica, sans-serif";
}

function normalizeFontFamily(fontFamily) {
  if (!fontFamily) {
    return "";
  }
  const cleaned = String(fontFamily).trim();
  if (!cleaned) {
    return "";
  }
  if (cleaned.includes(",")) {
    return cleaned;
  }
  if (cleaned.startsWith("'") || cleaned.startsWith("\"")) {
    return `${cleaned}, sans-serif`;
  }
  return `'${cleaned}', sans-serif`;
}

function deriveFontTraits(fontName, fontFamily) {
  const source = `${fontName || ""} ${fontFamily || ""}`.toLowerCase();
  const weight = /bold|black|heavy|demi|semibold/.test(source) ? "700" : "400";
  const style = /italic|oblique/.test(source) ? "italic" : "normal";
  return { weight, style };
}

function estimateTextWidthPx(text, fontSizePx, fontFamily, fontStyle = "normal", fontWeight = "400") {
  if (!estimateTextWidthPx.canvas) {
    estimateTextWidthPx.canvas = document.createElement("canvas");
  }
  const ctx = estimateTextWidthPx.canvas.getContext("2d");
  ctx.font = `${fontStyle} ${fontWeight} ${fontSizePx}px ${fontFamily || "sans-serif"}`;
  return ctx.measureText(text || "").width;
}

function fitInputWidth(input, minWidth) {
  input.style.width = "1px";
  const needed = Math.ceil(input.scrollWidth + 12);
  input.style.width = `${Math.max(minWidth, needed)}px`;
}

function syncInputVisibility(itemRecord) {
  const isFocused = document.activeElement === itemRecord.input;
  const isChanged = itemRecord.value !== itemRecord.original;
  itemRecord.input.classList.toggle("is-visible", isFocused || isChanged);
}

function sampleTextAndBackgroundColor(context, x, y, width, height) {
  const innerBuckets = createColorBuckets();
  accumulateColorBuckets(context, x, y, width, height, innerBuckets);

  const backgroundBuckets = createColorBuckets();
  const bandPadding = Math.max(2, Math.round(Math.min(width, height) * 0.16));
  const bandThickness = Math.max(2, Math.round(Math.min(width, height) * 0.18));
  const bands = [
    { x: x - bandPadding, y: y - bandPadding - bandThickness, width: width + bandPadding * 2, height: bandThickness },
    { x: x - bandPadding, y: y + height + bandPadding, width: width + bandPadding * 2, height: bandThickness },
    { x: x - bandPadding - bandThickness, y: y - bandPadding, width: bandThickness, height: height + bandPadding * 2 },
    { x: x + width + bandPadding, y: y - bandPadding, width: bandThickness, height: height + bandPadding * 2 },
  ];

  for (const band of bands) {
    accumulateColorBuckets(context, band.x, band.y, band.width, band.height, backgroundBuckets);
  }

  const bgSource = backgroundBuckets.lightCount ? backgroundBuckets : innerBuckets;
  const bgRgb = normalizeBackgroundRgb(
    bgSource.lightCount
      ? {
          r: Math.round(bgSource.lightR / bgSource.lightCount),
          g: Math.round(bgSource.lightG / bgSource.lightCount),
          b: Math.round(bgSource.lightB / bgSource.lightCount),
        }
      : { r: 255, g: 255, b: 255 }
  );

  const textRgb = innerBuckets.darkCount
    ? {
        r: Math.round(innerBuckets.darkR / innerBuckets.darkCount),
        g: Math.round(innerBuckets.darkG / innerBuckets.darkCount),
        b: Math.round(innerBuckets.darkB / innerBuckets.darkCount),
      }
    : { r: 20, g: 20, b: 20 };

  return {
    bgRgb,
    textRgb,
    bgCss: `rgb(${bgRgb.r}, ${bgRgb.g}, ${bgRgb.b})`,
    textCss: `rgb(${textRgb.r}, ${textRgb.g}, ${textRgb.b})`,
  };
}

function createColorBuckets() {
  return {
    lightR: 0,
    lightG: 0,
    lightB: 0,
    lightCount: 0,
    darkR: 0,
    darkG: 0,
    darkB: 0,
    darkCount: 0,
  };
}

function accumulateColorBuckets(context, x, y, width, height, buckets) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const safeX = clamp(Math.floor(x), 0, context.canvas.width - 1);
  const safeY = clamp(Math.floor(y), 0, context.canvas.height - 1);
  const safeWidth = clamp(Math.ceil(width), 1, context.canvas.width - safeX);
  const safeHeight = clamp(Math.ceil(height), 1, context.canvas.height - safeY);

  if (safeWidth <= 0 || safeHeight <= 0) {
    return;
  }

  const image = context.getImageData(safeX, safeY, safeWidth, safeHeight);
  const data = image.data;

  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const alpha = data[i + 3];

    if (alpha < 40) {
      continue;
    }

    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luminance > 170) {
      buckets.lightR += r;
      buckets.lightG += g;
      buckets.lightB += b;
      buckets.lightCount += 1;
    } else {
      buckets.darkR += r;
      buckets.darkG += g;
      buckets.darkB += b;
      buckets.darkCount += 1;
    }
  }
}

function normalizeBackgroundRgb(rgb) {
  const minChannel = Math.min(rgb.r, rgb.g, rgb.b);
  const maxChannel = Math.max(rgb.r, rgb.g, rgb.b);

  if (minChannel >= 238) {
    return { r: 255, g: 255, b: 255 };
  }

  if (minChannel >= 230 && maxChannel - minChannel <= 6) {
    const average = Math.round((rgb.r + rgb.g + rgb.b) / 3);
    return { r: average, g: average, b: average };
  }

  return rgb;
}

function initializeSignaturePad() {
  signaturePad.ctx.lineWidth = 2.2;
  signaturePad.ctx.lineJoin = "round";
  signaturePad.ctx.lineCap = "round";
  signaturePad.ctx.strokeStyle = "#10271f";

  signatureCanvas.addEventListener("pointerdown", (event) => {
    const point = getCanvasPoint(event);
    signaturePad.drawing = true;
    signaturePad.drawn = true;
    signaturePad.ctx.beginPath();
    signaturePad.ctx.moveTo(point.x, point.y);
  });

  signatureCanvas.addEventListener("pointermove", (event) => {
    if (!signaturePad.drawing) {
      return;
    }
    const point = getCanvasPoint(event);
    signaturePad.ctx.lineTo(point.x, point.y);
    signaturePad.ctx.stroke();
  });

  window.addEventListener("pointerup", () => {
    signaturePad.drawing = false;
  });
}

function getCanvasPoint(event) {
  const rect = signatureCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (signatureCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (signatureCanvas.height / rect.height),
  };
}

function clearSignatureCanvas() {
  signaturePad.ctx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
  signaturePad.drawn = false;
}

function getTrimmedSignatureDataUrl() {
  if (!signaturePad.drawn) {
    return null;
  }

  const image = signaturePad.ctx.getImageData(0, 0, signatureCanvas.width, signatureCanvas.height);
  const { data, width, height } = image;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  const pad = 8;
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = cropWidth + pad * 2;
  outCanvas.height = cropHeight + pad * 2;

  const outCtx = outCanvas.getContext("2d");
  outCtx.drawImage(
    signatureCanvas,
    minX,
    minY,
    cropWidth,
    cropHeight,
    pad,
    pad,
    cropWidth,
    cropHeight
  );

  return outCanvas.toDataURL("image/png");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clearEditor() {
  state.pages = [];
  editor.innerHTML = "";
  editor.classList.add("empty");
  pageHint.textContent = "Selected page: -";

  const placeholder = document.createElement("p");
  placeholder.className = "placeholder";
  placeholder.textContent = "Rendering...";
  editor.append(placeholder);
}

function setToolsEnabled(enabled) {
  imageInput.disabled = !enabled;
  toggleSignatureBtn.disabled = !enabled;
  clearSignatureBtn.disabled = !enabled;
  addSignatureBtn.disabled = !enabled;
  const imageUploadWrap = imageInput.closest(".upload");
  if (imageUploadWrap) {
    imageUploadWrap.classList.toggle("disabled", !enabled);
  }

  if (!enabled) {
    signaturePanel.classList.add("hidden");
    toggleSignatureBtn.textContent = "Signature Pad";
  }
}

function triggerDownload(bytes, fileName) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 4000);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#8a1f00" : "#325a4a";
}
